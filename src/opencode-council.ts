import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Briefing, Transmission } from "./briefing/model"
import type { District, Scenario } from "../stage/city/scenario"
import type { CouncilState } from "./council-service"
import type { Advisor, AdvisorId, AudioClip, Expression, Viseme, VisemeCue, WordCue } from "./domain"

// Read-only OpenCode V2 history -> Civilization II High Council state, Briefing, and Scenario.
// Never mutates the OpenCode SQLite database (opened with readonly: true and PRAGMA query_only = 1).

export const DEFAULT_OPENCODE_DB = join(homedir(), ".local", "share", "opencode", "opencode.db")

const GENERIC_MODEL_TOKENS = new Set([
  "opencode", "claude", "opus", "sonnet", "haiku", "gpt", "gemini", "free", "eap", "mini", "pro",
  "preview", "default", "latest", "flash", "nano", "turbo", "chat", "codex", "high", "low", "medium",
  "anthropic", "openai", "google", "console", "openrouter", "local", "model", "auto", "zen", "fast",
])

// Derive denylist dynamically from model identifiers seen in the DB + HIGH_COUNCIL_DENY, never stored in the repo.
const ALWAYS_DENY: string[] = []

export interface OpenCodeDateSummary {
  readonly date: string
  readonly sessions: number
  readonly turns: number
  readonly projects: string[]
}

export interface FileTouch {
  readonly path: string
  readonly project: string
  readonly edits: number
  readonly reads: number
}

export interface ProjectSummary {
  readonly name: string
  readonly sessions: number
  readonly turns: number
  readonly additions: number
  readonly deletions: number
  readonly files: number
  readonly cost: number
  readonly topTitles: string[]
  readonly topFiles: string[]
}

export interface OpenCodeDayDigest {
  readonly date: string
  readonly primaryRepo: string
  readonly totalSessions: number
  readonly subagentSessions: number
  readonly totalTurns: number
  readonly totalToolCalls: number
  readonly totalAdditions: number
  readonly totalDeletions: number
  readonly totalFiles: number
  readonly totalCost: number
  readonly cacheHitPct: number
  readonly slowestTurnSec: number
  readonly slowestSessionTitle: string
  readonly errorCount: number
  readonly topEditedFile: FileTouch | null
  readonly topReadFile: FileTouch | null
  readonly mostRetriedFile: FileTouch | null
  readonly projects: ProjectSummary[]
}

function charToViseme(ch: string, idx: number): Viseme {
  const c = ch.toLowerCase()
  if ("mbp .,!?;:—-\n\t\"'".includes(c)) return "closed"
  if ("fv".includes(c)) return "fv"
  if ("ouwq".includes(c)) return "round"
  if ("a".includes(c)) return "open"
  if ("eiyszjc".includes(c)) return "wide"
  return idx % 2 === 0 ? "open" : "wide"
}

export function synthesizeClipTiming(id: string, advisorId: AdvisorId, text: string, audioUrl = ""): AudioClip {
  const rawWords = text.trim().split(/\s+/).filter(Boolean)
  const weights = rawWords.map((w) => w.length + (/[.,?!;:]$/.test(w) ? 3.0 : 0.65))
  const totalW = Math.max(1, weights.reduce((a, v) => a + v, 0))
  // ~155 words per minute theatrical Civ II cadence
  const duration = Number(Math.max(3.2, Math.min(28, rawWords.length * 0.36 + 0.6)).toFixed(2))
  const usable = duration - 0.25

  const words: WordCue[] = []
  const visemes: VisemeCue[] = []
  let cur = 0.08
  let charIdx = 0

  for (let i = 0; i < rawWords.length; i++) {
    const w = rawWords[i]!
    const slot = (weights[i]! / totalW) * usable
    const pause = /[.,?!;:]$/.test(w) ? Math.min(0.24, slot * 0.34) : Math.min(0.04, slot * 0.12)
    const speakDur = Math.max(0.08, slot - pause)
    const ws = Number(cur.toFixed(3))
    const we = Number((cur + speakDur).toFixed(3))
    words.push({ word: w, s: ws, e: we })

    const chars = [...w]
    const charStep = speakDur / Math.max(1, chars.length)
    for (let c = 0; c < chars.length; c++) {
      const cs = Number((ws + c * charStep).toFixed(3))
      const ce = Number((ws + (c + 1) * charStep).toFixed(3))
      const v = charToViseme(chars[c]!, charIdx++)
      const prev = visemes[visemes.length - 1]
      if (prev && prev.v === v && Math.abs(prev.e - cs) < 0.05) {
        ;(prev as { e: number }).e = ce
      } else {
        visemes.push({ t: cs, e: ce, v })
      }
    }
    if (pause > 0.015) {
      visemes.push({ t: we, e: Number((cur + slot).toFixed(3)), v: "closed" })
    }
    cur += slot
  }

  return { id, advisorId, text, audioUrl, duration, visemes, words }
}

function buildScrubber(db: Database, fromMs: number, toMs: number) {
  const deny = new Set<string>(ALWAYS_DENY)
  for (const tok of (process.env.HIGH_COUNCIL_DENY ?? "").split(",")) {
    const t = tok.trim().toLowerCase()
    if (t) deny.add(t)
  }
  try {
    const sRows = db
      .query<{ m: string }, []>(`select distinct json_extract(model, '$.id') as m from session_v2 where model is not null`)
      .all()
    for (const r of sRows) {
      if (!r?.m) continue
      for (const tok of r.m.toLowerCase().split(/[^a-z0-9]+/)) {
        if (tok.length >= 4 && !/^\d+$/.test(tok) && !GENERIC_MODEL_TOKENS.has(tok)) deny.add(tok)
      }
    }
  } catch {}

  const home = homedir()
  const denyRe = deny.size
    ? new RegExp(`\\b(${[...deny].map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi")
    : null

  return (input: string): string => {
    let out = input
    if (home && home.length > 1) {
      out = out.split(home).join("~")
    }
    out = out.replace(/\/Users\/[^/\s"']+/g, "~")
    if (denyRe) out = out.replace(denyRe, "model")
    return out
  }
}

function cleanRelPath(rawPath: string, projectDir: string, scrub: (s: string) => string): string {
  let p = rawPath.trim()
  if (!p) return ""
  if (projectDir && p.startsWith(projectDir)) {
    p = p.slice(projectDir.length).replace(/^\/+/, "")
  }
  p = scrub(p)
  if (p.startsWith("~/")) {
    const parts = p.split("/")
    if (parts.length > 4) p = parts.slice(-3).join("/")
  }
  return p
}

export function listOpenCodeDates(dbPath = DEFAULT_OPENCODE_DB, limit = 14): OpenCodeDateSummary[] {
  if (!existsSync(dbPath)) return []
  const db = new Database(dbPath, { readonly: true })
  try {
    db.exec("PRAGMA query_only = 1")
    const hasV2 = db.query("select name from sqlite_master where type='table' and name='session_v2'").get()
    if (!hasV2) return []

    const rows = db
      .query<{ d: string; sessions: number; turns: number; dirs: string }, [number]>(
        `select strftime('%Y-%m-%d', s.time_updated / 1000, 'unixepoch', 'localtime') as d,
                count(*) as sessions,
                sum(coalesce(s.summary_files, 1)) as turns,
                group_concat(distinct s.directory) as dirs
         from session_v2 s
         where s.time_updated > 0
         group by d
         order by d desc
         limit ?`,
      )
      .all(limit)

    return rows
      .filter((r) => Boolean(r.d))
      .map((r) => {
        const projects = [...new Set((r.dirs ?? "").split(",").map((dir) => dir.replace(/\/+$/, "").split("/").pop() || "").filter(Boolean))].slice(0, 4)
        return { date: r.d, sessions: r.sessions, turns: r.turns, projects }
      })
  } catch {
    return []
  } finally {
    db.close()
  }
}

export function extractOpenCodeDay(date: string, dbPath = DEFAULT_OPENCODE_DB): OpenCodeDayDigest | null {
  if (!existsSync(dbPath)) return null
  const db = new Database(dbPath, { readonly: true })
  try {
    db.exec("PRAGMA query_only = 1")
    const hasV2 = db.query("select name from sqlite_master where type='table' and name='session_v2'").get()
    if (!hasV2) return null

    const [y, m, d] = date.split("-").map(Number)
    if (!y || !m || !d) return null
    const fromMs = new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
    const toMs = new Date(y, m - 1, d + 1, 0, 0, 0, 0).getTime()
    const scrub = buildScrubber(db, fromMs, toMs)

    type MsgRow = {
      sid: string
      type: string
      t: number
      streamed: number | null
      completed: number | null
      cost: number | null
      tools: string | null
      files: string | null
      statuses: string | null
    }

    const msgRows = db
      .query<MsgRow, [number, number]>(
        `select m.session_id sid,
                m.type type,
                m.time_created t,
                case when m.type='assistant' then json_extract(m.data,'$.time.streamed') end streamed,
                case when m.type='assistant' then json_extract(m.data,'$.time.completed') end completed,
                case when m.type='assistant' then json_extract(m.data,'$.cost') end cost,
                case when m.type='assistant' then (select json_group_array(json_extract(c.value,'$.name')) from json_each(m.data,'$.content') c where json_extract(c.value,'$.type')='tool') end tools,
                case when m.type='assistant' then (select json_group_array(coalesce(json_extract(c.value,'$.state.input.filePath'), json_extract(c.value,'$.state.input.path'), '')) from json_each(m.data,'$.content') c where json_extract(c.value,'$.type')='tool') end files,
                case when m.type='assistant' then (select json_group_array(coalesce(json_extract(c.value,'$.state.status'), '')) from json_each(m.data,'$.content') c where json_extract(c.value,'$.type')='tool') end statuses
         from session_message m
         join session_v2 s on s.id = m.session_id
         where m.time_created >= ? and m.time_created < ? and m.type in ('user','assistant')
         order by m.time_created`,
      )
      .all(fromMs, toMs)

    if (!msgRows.length) return null

    type SessRow = {
      id: string
      parent_id: string | null
      directory: string
      title: string | null
      additions: number
      deletions: number
      files: number
      cost: number
      tok_in: number
      tok_cache: number
    }

    const sessStmt = db.query<SessRow, [string]>(
      `select id, parent_id, directory, title,
              coalesce(summary_additions, 0) as additions,
              coalesce(summary_deletions, 0) as deletions,
              coalesce(summary_files, 0) as files,
              coalesce(cost, 0) as cost,
              coalesce(tokens_input, 0) as tok_in,
              coalesce(tokens_cache_read, 0) as tok_cache
       from session_v2 where id = ?`,
    )

    const sessions = new Map<string, SessRow>()
    for (const r of msgRows) {
      if (!sessions.has(r.sid)) {
        const s = sessStmt.get(r.sid)
        if (s) sessions.set(r.sid, s)
      }
    }

    const projMap = new Map<
      string,
      {
        name: string
        sessions: Set<string>
        turns: number
        additions: number
        deletions: number
        files: number
        cost: number
        titles: Set<string>
        fileTouches: Map<string, number>
      }
    >()

    const fileMap = new Map<string, { path: string; project: string; edits: number; reads: number }>()
    let totalToolCalls = 0
    let errorCount = 0
    let slowestTurnSec = 0
    let slowestSessionTitle = "Interactive session"

    const projectLabelOf = (dir: string) => {
      const cleaned = dir.replace(/\/+$/, "")
      if (cleaned === homedir()) return "home"
      // Collapse worktree paths to their parent project name when possible
      const wtMatch = cleaned.match(/\/worktree\/[^/]+\/([^/]+)$/)
      if (wtMatch?.[1]) return scrub(wtMatch[1])
      return scrub(cleaned.split("/").pop() || "workspace")
    }

    for (const s of sessions.values()) {
      const pName = projectLabelOf(s.directory)
      let p = projMap.get(pName)
      if (!p) {
        p = {
          name: pName,
          sessions: new Set(),
          turns: 0,
          additions: 0,
          deletions: 0,
          files: 0,
          cost: 0,
          titles: new Set(),
          fileTouches: new Map(),
        }
        projMap.set(pName, p)
      }
      p.sessions.add(s.id)
      p.additions += s.additions
      p.deletions += s.deletions
      p.files += s.files
      p.cost += s.cost
      if (s.title && !s.title.startsWith("New session")) {
        p.titles.add(scrub(s.title).slice(0, 72))
      }
    }

    for (const r of msgRows) {
      const s = sessions.get(r.sid)
      if (!s) continue
      const pName = projectLabelOf(s.directory)
      const p = projMap.get(pName)!
      p.turns++

      if (r.type === "assistant") {
        if (r.completed && r.t && r.completed > r.t) {
          const durSec = (r.completed - r.t) / 1000
          if (durSec > slowestTurnSec && durSec < 1800) {
            slowestTurnSec = durSec
            slowestSessionTitle = s.title ? scrub(s.title).slice(0, 60) : pName
          }
        }
        try {
          const tools: string[] = r.tools ? JSON.parse(r.tools) : []
          const files: string[] = r.files ? JSON.parse(r.files) : []
          const statuses: string[] = r.statuses ? JSON.parse(r.statuses) : []
          totalToolCalls += tools.length
          for (let i = 0; i < tools.length; i++) {
            const toolName = (tools[i] ?? "").toLowerCase()
            const rawFile = files[i] ?? ""
            const status = (statuses[i] ?? "").toLowerCase()
            if (status === "error" || status === "failed") errorCount++
            if (rawFile) {
              const rel = cleanRelPath(rawFile, s.directory, scrub)
              if (rel && !rel.startsWith(".") && rel.includes(".")) {
                const key = `${pName}:${rel}`
                let ft = fileMap.get(key)
                if (!ft) {
                  ft = { path: rel, project: pName, edits: 0, reads: 0 }
                  fileMap.set(key, ft)
                }
                if (/edit|write|patch/.test(toolName)) ft.edits++
                else ft.reads++
                p.fileTouches.set(rel, (p.fileTouches.get(rel) ?? 0) + 1)
              }
            }
          }
        } catch {}
      }
    }

    let totalAdditions = 0
    let totalDeletions = 0
    let totalFiles = 0
    let totalCost = 0
    let totalTokIn = 0
    let totalTokCache = 0
    let subagentSessions = 0

    for (const s of sessions.values()) {
      totalAdditions += s.additions
      totalDeletions += s.deletions
      totalFiles += s.files
      totalCost += s.cost
      totalTokIn += s.tok_in
      totalTokCache += s.tok_cache
      if (s.parent_id) subagentSessions++
    }

    totalFiles = Math.max(totalFiles, fileMap.size)
    const cacheHitPct =
      totalTokIn + totalTokCache > 0
        ? Math.round((totalTokCache / (totalTokIn + totalTokCache)) * 100)
        : 84

    const fileList = [...fileMap.values()]
    const topEditedFile =
      [...fileList].sort((a, b) => b.edits - a.edits || b.reads - a.reads)[0] ?? null
    const topReadFile =
      [...fileList].sort((a, b) => b.reads - a.reads || b.edits - a.edits)[0] ?? null
    const mostRetriedFile =
      [...fileList].filter((f) => f.edits >= 2).sort((a, b) => b.edits + b.reads - (a.edits + a.reads))[0] ??
      topEditedFile

    const projects: ProjectSummary[] = [...projMap.values()]
      .sort((a, b) => b.turns - a.turns)
      .map((p) => ({
        name: p.name,
        sessions: p.sessions.size,
        turns: p.turns,
        additions: p.additions,
        deletions: p.deletions,
        files: p.files,
        cost: Number(p.cost.toFixed(2)),
        topTitles: [...p.titles].slice(0, 4),
        topFiles: [...p.fileTouches.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([f]) => f),
      }))

    return {
      date,
      primaryRepo: projects[0]?.name ?? "workspace",
      totalSessions: sessions.size,
      subagentSessions,
      totalTurns: msgRows.length,
      totalToolCalls,
      totalAdditions,
      totalDeletions,
      totalFiles,
      totalCost: Number(totalCost.toFixed(2)),
      cacheHitPct,
      slowestTurnSec: Math.round(slowestTurnSec || 18),
      slowestSessionTitle,
      errorCount,
      topEditedFile,
      topReadFile,
      mostRetriedFile,
      projects,
    }
  } catch {
    return null
  } finally {
    db.close()
  }
}

export function buildCouncilFromOpenCodeDay(d: OpenCodeDayDigest): {
  council: CouncilState
  briefing: Briefing
  scenario: Scenario
} {
  const hotEdit = d.topEditedFile?.path ?? `${d.primaryRepo}/src/index.ts`
  const hotEditCount = d.topEditedFile?.edits ?? Math.max(3, Math.round(d.totalToolCalls / 12))
  const hotRead = d.topReadFile?.path ?? hotEdit
  const hotReadCount = d.topReadFile?.reads ?? Math.max(4, Math.round(d.totalToolCalls / 8))
  const retryFile = d.mostRetriedFile?.path ?? hotEdit
  const topProj = d.projects[0]
  const secondProj = d.projects[1] ?? topProj

  const hasLocDelta = d.totalAdditions > 0 || d.totalDeletions > 0
  const netDelta = d.totalAdditions - d.totalDeletions
  const addStr = `+${d.totalAdditions.toLocaleString()}`
  const delStr = `-${d.totalDeletions.toLocaleString()}`
  const churnMetric = hasLocDelta ? `${addStr} / ${delStr} LOC` : `${hotEditCount} edits · ${d.totalFiles} files`

  const pitchSpecs: Record<
    AdvisorId,
    {
      title: string
      text: string
      expr: Expression
      reactions: Record<AdvisorId, Expression>
      interjId: string
      interjAdvisor: AdvisorId
      interjText: string
      interjExpr: Expression
      targetExpr: Expression
      evidence: Advisor["evidence"]
    }
  > = {
    simplifier: {
      title:
        netDelta > 0
          ? `Prune ${netDelta.toLocaleString()} net lines added across ${d.projects.length} active repos (${addStr} / ${delStr})`
          : `Consolidate ${hotEdit} after ${hotEditCount} edits on ${d.date}`,
      text: hasLocDelta
        ? `Sire! On ${d.date} our scribes added ${d.totalAdditions} lines and deleted ${d.totalDeletions} across ${d.totalSessions} sessions, hammering ${hotEdit} ${hotEditCount} times! Give me the royal shears to extract the dead branches before they calcify!`
        : `Sire! On ${d.date} our scribes touched ${d.totalFiles} files across ${d.totalSessions} sessions, hammering ${hotEdit} ${hotEditCount} separate times! Give me the royal shears to consolidate that module before it calcifies!`,
      expr: "excited",
      reactions: {
        simplifier: "excited",
        performance: "smug",
        "bug-hunter": "worried",
        architect: "annoyed",
        "user-voice": "neutral",
        contrarian: "smug",
      },
      interjId: `interj-simplifier-${d.date}`,
      interjAdvisor: "architect",
      interjText: `Hold your shears! ${hotEdit} carries the domain boundary for ${d.primaryRepo}!`,
      interjExpr: "annoyed",
      targetExpr: "smug",
      evidence: {
        targetFile: hotEdit,
        refLabel: `${d.date} · ${hotEditCount} edits`,
        metric: churnMetric,
        diffPreview: `- // ${d.date}: ${d.totalFiles.toLocaleString()} files touched across ${d.totalSessions} sessions\n- // Hottest churn target: ${hotEdit} (${hotEditCount} edit passes, ${d.topEditedFile?.reads ?? 0} reads)\n+ // Proposal: collapse duplicate helpers in ${hotEdit}`,
        prPlanSteps: [
          `Audit the ${hotEditCount} edit passes in ${hotEdit} and inline one-off helper wrappers`,
          `Delete unused scratch exports left behind across ${d.primaryRepo}`,
          `Verify tests pass with net-negative line count`,
        ],
      },
    },
    performance: {
      title: `Trim ${d.slowestTurnSec}s peak turn latency and ${d.totalToolCalls} tool dispatches (${d.cacheHitPct}% cache hit)`,
      text: `My liege! The hourglass bleeds! Across ${d.totalTurns} turns on ${d.date}, our agents fired ${d.totalToolCalls} tool calls and read ${hotRead} ${hotReadCount} times, peaking at ${d.slowestTurnSec} seconds on a single turn! Batch your reads at once!`,
      expr: "excited",
      reactions: {
        simplifier: "worried",
        performance: "excited",
        "bug-hunter": "worried",
        architect: "neutral",
        "user-voice": "excited",
        contrarian: "smug",
      },
      interjId: `interj-performance-${d.date}`,
      interjAdvisor: "bug-hunter",
      interjText: `Careful, alchemist! Blindly caching ${hotRead} will serve stale state mid-edit!`,
      interjExpr: "worried",
      targetExpr: "annoyed",
      evidence: {
        targetFile: hotRead,
        refLabel: `${d.cacheHitPct}% prompt cache · ${d.totalToolCalls} tools`,
        metric: `${d.slowestTurnSec}s peak turn`,
        diffPreview: `- // ${hotRead} read ${hotReadCount} times across ${d.totalSessions} sessions\n- // Peak turn wall clock: ${d.slowestTurnSec}s (${d.slowestSessionTitle})\n+ // Batch parallel reads and keep prompt cache warm (${d.cacheHitPct}% hit rate)`,
        prPlanSteps: [
          `Combine repeated reads of ${hotRead} (${hotReadCount} reads) into a single context pass`,
          `Parallelize independent tool calls in ${d.primaryRepo} workflows`,
          `Keep subagent fan-out (${d.subagentSessions} child sessions) bounded on hot turns`,
        ],
      },
    },
    "bug-hunter": {
      title:
        d.errorCount > 0
          ? `Quarantine ${d.errorCount} failed tool executions and retry loops in ${retryFile}`
          : `Add regression guard around ${retryFile} (${hotEditCount} rapid edits)`,
      text:
        d.errorCount > 0
          ? `Look closely, Sire! My jar caught ${d.errorCount} failed tool calls and retry loops crawling through ${retryFile} on ${d.date}! Pin that edge case under glass with a regression test before it escapes into production!`
          : `Look closely, Sire! ${retryFile} was rewritten ${hotEditCount} times during ${d.date} without a dedicated regression test! One subtle race condition in that module will bite the realm at midnight!`,
      expr: "excited",
      reactions: {
        simplifier: "neutral",
        performance: "worried",
        "bug-hunter": "excited",
        architect: "worried",
        "user-voice": "excited",
        contrarian: "annoyed",
      },
      interjId: `interj-bughunter-${d.date}`,
      interjAdvisor: "contrarian",
      interjText: `Oh please, Barnaby, half of those retries were your own typo in the shell command!`,
      interjExpr: "smug",
      targetExpr: "worried",
      evidence: {
        targetFile: retryFile,
        refLabel: `${d.date} · ${d.errorCount} tool errors`,
        metric: `${d.errorCount} errors · ${hotEditCount} edits`,
        diffPreview: `- // Observed on ${d.date}: ${d.errorCount} failed tool calls, ${hotEditCount} edits in ${retryFile}\n+ test("${retryFile} regression guard", async () => {\n+   // Lock in behavior from ${d.date} session\n+ })`,
        prPlanSteps: [
          `Add a focused regression test covering the ${retryFile} changes from ${d.date}`,
          `Guard error paths where ${d.errorCount || 1} tool retries occurred during the day`,
        ],
      },
    },
    architect: {
      title: `Formalize module boundary across ${d.projects.map((p) => p.name).slice(0, 3).join(", ")} (${d.totalFiles} files touched)`,
      text: `Noble Sovereign, on ${d.date} our builders touched ${d.totalFiles} files across ${d.projects.length} project realms, led by ${d.primaryRepo}${secondProj && secondProj.name !== d.primaryRepo ? ` and ${secondProj.name}` : ""}! Erect a clean schema contract between ${hotEdit} and its callers!`,
      expr: "smug",
      reactions: {
        simplifier: "annoyed",
        performance: "annoyed",
        "bug-hunter": "neutral",
        architect: "smug",
        "user-voice": "annoyed",
        contrarian: "smug",
      },
      interjId: `interj-architect-${d.date}`,
      interjAdvisor: "simplifier",
      interjText: `No more marble towers, Vitruvius! We touched ${d.totalFiles} files—stop adding layers!`,
      interjExpr: "annoyed",
      targetExpr: "annoyed",
      evidence: {
        targetFile: hotEdit,
        refLabel: `${d.projects.length} repos · ${d.totalFiles} files`,
        metric: `${d.totalFiles} files touched`,
        diffPreview: `// Active projects on ${d.date}:\n${d.projects
          .slice(0, 3)
          .map((p) => `//   ${p.name}: ${p.sessions} sessions, ${p.turns} turns (+${p.additions}/-${p.deletions})`)
          .join("\n")}`,
        prPlanSteps: [
          `Extract a typed interface at the boundary of ${hotEdit}`,
          `Decouple ${d.primaryRepo} domain logic from transport/CLI wiring`,
        ],
      },
    },
    "user-voice": {
      title: `Ship the top ${d.primaryRepo} milestone (${topProj?.topTitles[0] ?? `${d.totalSessions} active sessions`})`,
      text: `Hear the petitions of the commons, Sire! On ${d.date} you drove ${d.totalSessions} sessions on ${d.primaryRepo}, led by "${topProj?.topTitles[0] ?? d.slowestSessionTitle}". Polish the user-facing flow and ship it before opening another worktree!`,
      expr: "worried",
      reactions: {
        simplifier: "excited",
        performance: "neutral",
        "bug-hunter": "excited",
        architect: "annoyed",
        "user-voice": "worried",
        contrarian: "neutral",
      },
      interjId: `interj-uservoice-${d.date}`,
      interjAdvisor: "user-voice",
      interjText: `The citizens cannot eat unmerged branches, Sire—ship ${d.primaryRepo} today!`,
      interjExpr: "annoyed",
      targetExpr: "worried",
      evidence: {
        targetFile: topProj?.topFiles[0] ?? hotEdit,
        refLabel: `${topProj?.sessions ?? d.totalSessions} sessions in ${d.primaryRepo}`,
        metric: `${d.totalSessions} sessions`,
        diffPreview: `// Top user-facing threads on ${d.date}:\n${(topProj?.topTitles.length ? topProj.topTitles : [d.slowestSessionTitle])
          .slice(0, 3)
          .map((t, i) => `${i + 1}. ${t}`)
          .join("\n")}`,
        prPlanSteps: [
          `Verify the end-to-end user flow for "${topProj?.topTitles[0] ?? d.primaryRepo}"`,
          `Land and announce the finished ${d.primaryRepo} changes before starting new experiments`,
        ],
      },
    },
    contrarian: {
      title: `Question why ${d.totalSessions} sessions and ${d.subagentSessions} subagents were needed on ${d.date}`,
      text: `Oh, magnificent, Sire! ${d.totalSessions} sessions, ${d.subagentSessions} subagents, and ${d.totalToolCalls} tool calls in a single day! Have you considered that half of ${d.primaryRepo} worked better before your grand crusade began?`,
      expr: "smug",
      reactions: {
        simplifier: "annoyed",
        performance: "excited",
        "bug-hunter": "annoyed",
        architect: "annoyed",
        "user-voice": "annoyed",
        contrarian: "smug",
      },
      interjId: `interj-contrarian-${d.date}`,
      interjAdvisor: "performance",
      interjText: `Quiet, Malvolio! Those ${d.subagentSessions} parallel subagents saved us hours of wall clock!`,
      interjExpr: "annoyed",
      targetExpr: "smug",
      evidence: {
        targetFile: hotEdit,
        refLabel: `${d.totalSessions} sessions · ${d.subagentSessions} subagents`,
        metric: `${d.totalTurns} turns`,
        diffPreview: `- // Session sprawl on ${d.date}: ${d.totalSessions} total (${d.subagentSessions} child subagents)\n+ // Rule: finish 1 active branch in ${d.primaryRepo} before spawning the next`,
        prPlanSteps: [
          `Close stale worktrees and finished sessions from ${d.date}`,
          `Cap parallel workstreams to the top priority in ${d.primaryRepo}`,
        ],
      },
    },
  }

  const metaByAdvisor: { id: AdvisorId; name: string; icon: string; accent: string }[] = [
    { id: "simplifier", name: "Simplifier", icon: "🧹", accent: "#4aa8d8" },
    { id: "performance", name: "Performance", icon: "⚡", accent: "#f0b429" },
    { id: "bug-hunter", name: "Bug Hunter", icon: "🐛", accent: "#3dd68c" },
    { id: "architect", name: "Architect", icon: "🏛", accent: "#5c8df6" },
    { id: "user-voice", name: "User Voice", icon: "🗣", accent: "#d966a8" },
    { id: "contrarian", name: "Contrarian", icon: "😈", accent: "#e5484d" },
  ]

  const clips: Record<string, AudioClip> = {}
  const advisors: Advisor[] = metaByAdvisor.map((m) => {
    const spec = pitchSpecs[m.id]
    const pitchClipId = `${m.id}-pitch-${d.date}`
    clips[pitchClipId] = synthesizeClipTiming(pitchClipId, m.id, spec.text)
    clips[spec.interjId] = synthesizeClipTiming(spec.interjId, spec.interjAdvisor, spec.interjText)
    return {
      id: m.id,
      name: m.name,
      icon: m.icon,
      accent: m.accent,
      pitchClipId,
      pitchTitle: spec.title,
      pitchExpression: spec.expr,
      councilReactions: spec.reactions,
      interjections: [
        {
          advisorId: spec.interjAdvisor,
          clipId: spec.interjId,
          expression: spec.interjExpr,
          targetExpression: spec.targetExpr,
        },
      ],
      evidence: spec.evidence,
      status: "pending",
    }
  })

  const council: CouncilState = {
    repo: `${d.primaryRepo} · ${d.date}`,
    branch: `${d.totalSessions} sessions · ${d.totalTurns} turns`,
    advisors,
    clips,
  }

  // Also synthesize a 4-caller Briefing for Codec / Star Fox / Cabinet skins
  const callerDefs = [
    {
      id: "chief",
      name: "Vesna",
      role: "Chief of Staff",
      frequency: "140.15",
      portrait: "chief",
      headline: `${d.date}: ${d.totalSessions} sessions across ${d.projects.length} projects`,
      priority: "urgent" as const,
      script: `Report for ${d.date}. You ran ${d.totalSessions} OpenCode sessions and ${d.totalTurns} turns across ${d.projects.length} projects, led by ${d.primaryRepo}. Total code movement was ${d.totalAdditions} additions and ${d.totalDeletions} deletions across ${d.totalFiles} files, with ${d.subagentSessions} subagents spawned. Start today by landing the open changes in ${hotEdit}.`,
      dossier: d.projects.slice(0, 4).map((p) => ({
        label: p.name.slice(0, 26),
        detail: `${p.sessions} sessions, ${p.turns} turns (+${p.additions} / -${p.deletions} LOC)`,
        when: `${p.files} files`,
      })),
      decree: {
        title: `Land open ${d.primaryRepo} work from ${d.date}`,
        steps: [
          `Review and commit pending changes in ${hotEdit}`,
          `Clean up finished worktrees from ${d.date}`,
        ],
      },
    },
    {
      id: "strategist",
      name: "Okafor",
      role: "Strategist",
      frequency: "140.48",
      portrait: "strategist",
      headline: `Focus on ${d.primaryRepo}, consolidate ${hotEdit}`,
      priority: "urgent" as const,
      script: `Looking at your ${d.date} telemetry, ${d.primaryRepo} carried the main effort while ${hotEdit} took ${hotEditCount} separate edit passes. Peak turn duration hit ${d.slowestTurnSec} seconds with a ${d.cacheHitPct} percent prompt cache hit rate. Consolidate ${hotEdit} first and hold off on side branches until ${d.primaryRepo} ships.`,
      dossier: [
        { label: "Primary initiative", detail: `${d.primaryRepo} (${topProj?.topTitles[0] ?? "active branch"})`, when: `${topProj?.sessions ?? 1} sess` },
        { label: "Highest churn file", detail: `${hotEdit} edited ${hotEditCount} times`, when: `${hotEditCount} edits` },
        { label: "Prompt cache efficiency", detail: `${d.cacheHitPct}% cache read across ${d.totalToolCalls} tool calls`, when: `${d.slowestTurnSec}s max` },
      ],
      decree: {
        title: `Consolidate ${hotEdit} and ship ${d.primaryRepo}`,
        steps: pitchSpecs.simplifier.evidence.prPlanSteps as string[],
      },
    },
    {
      id: "quartermaster",
      name: "Brennan",
      role: "Quartermaster",
      frequency: "140.85",
      portrait: "quartermaster",
      headline: `${d.totalToolCalls} tool dispatches, ${d.errorCount} tool errors`,
      priority: d.errorCount > 0 ? ("urgent" as const) : ("normal" as const),
      script: `Resource ledger for ${d.date}. Your agents executed ${d.totalToolCalls} tool calls with ${d.errorCount} tool errors and read ${hotRead} ${hotReadCount} times. Batching repeated reads on ${hotRead} and adding a regression check on ${retryFile} will keep today's runs fast and clean.`,
      dossier: [
        { label: "Most read file", detail: `${hotRead} (${hotReadCount} read passes)`, when: `${hotReadCount} reads` },
        { label: "Tool reliability", detail: `${d.totalToolCalls} total tool calls, ${d.errorCount} error states`, when: d.date },
        { label: "Subagent fleet", detail: `${d.subagentSessions} child subagents out of ${d.totalSessions} sessions`, when: "Bounded" },
      ],
      decree: {
        title: `Add regression check for ${retryFile}`,
        steps: pitchSpecs["bug-hunter"].evidence.prPlanSteps as string[],
      },
    },
    {
      id: "liaison",
      name: "Imani",
      role: "Liaison",
      frequency: "141.12",
      portrait: "liaison",
      headline: `Top threads in ${d.primaryRepo} ready for review`,
      priority: "normal" as const,
      script: `Here are the user-facing threads from ${d.date}. Your top session was ${topProj?.topTitles[0] ?? d.slowestSessionTitle} in ${d.primaryRepo}. Package the result, verify the fresh-user flow from a clean directory, and share the demo artifact once the checks are green.`,
      dossier: (topProj?.topTitles.length ? topProj.topTitles : [d.slowestSessionTitle]).slice(0, 4).map((t, i) => ({
        label: `Session thread 0${i + 1}`,
        detail: t,
        when: d.primaryRepo,
      })),
      decree: {
        title: `Verify and ship ${d.primaryRepo}`,
        steps: pitchSpecs["user-voice"].evidence.prPlanSteps as string[],
      },
    },
  ]

  const transmissions: Transmission[] = callerDefs.map((c) => {
    const timed = synthesizeClipTiming(c.id, "simplifier", c.script)
    return {
      id: c.id,
      caller: { id: c.id, name: c.name, role: c.role, frequency: c.frequency, portrait: c.portrait },
      headline: c.headline,
      priority: c.priority,
      script: c.script,
      dossier: c.dossier,
      decree: c.decree,
      clip: {
        url: "",
        duration: timed.duration,
        words: timed.words,
        mouth: timed.visemes.map((v) => ({ s: v.t, e: v.e, m: v.v === "closed" ? ("closed" as const) : ("open" as const) })),
      },
    }
  })

  const briefing: Briefing = {
    id: d.date,
    date: d.date,
    generatedAt: Date.now(),
    transmissions,
  }

  // Also map active projects into a tactical Scenario for /defcon, /breach, /overworld, /city
  const kinds: District["kind"][] = ["downtown", "industrial", "campus", "residential", "park"]
  const districts: District[] = d.projects.slice(0, 7).map((p, idx) => ({
    id: p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || `sector-${idx + 1}`,
    name: p.name,
    kind: kinds[idx % kinds.length]!,
    weight: Math.max(3, Math.min(10, Math.round(p.turns / 10) + 3)),
    activity: Math.min(1, Math.max(0.2, p.turns / Math.max(20, d.totalTurns * 0.5))),
    urgent: idx === 0 && d.errorCount > 0 ? Math.min(3, d.errorCount) : p.additions > 500 ? 1 : 0,
    stale: 0.1,
    items: [
      ...(p.topTitles.slice(0, 2).map((t) => ({ title: t, when: `${p.sessions} sess`, urgent: true }))),
      ...(p.topFiles.slice(0, 2).map((f) => ({ title: `Touched ${f}`, when: `+${p.additions}/-${p.deletions}` }))),
    ].slice(0, 4),
  }))

  if (!districts.length) {
    districts.push({
      id: "workspace",
      name: d.primaryRepo,
      kind: "downtown",
      weight: 8,
      activity: 0.8,
      urgent: 1,
      stale: 0,
      items: [{ title: d.slowestSessionTitle, when: d.date, urgent: true }],
    })
  }

  const scenario: Scenario = {
    title: `${d.primaryRepo} (${d.date})`,
    seed: Number(d.date.replace(/-/g, "")) || 7,
    districts,
  }

  return { council, briefing, scenario }
}

// Convert a portable Briefing JSON into a 6-advisor CouncilState so `--from briefing.json` works in Civ II Council too.
export async function draftCouncilWithModel(
  d: OpenCodeDayDigest,
  base: CouncilState,
  model: string,
): Promise<CouncilState> {
  const [providerID, ...rest] = model.split("/")
  const [id, variant] = rest.join("/").split("#")
  if (!providerID || !id) throw new Error(`Model must look like provider/model[#variant], got ${model}`)

  const summary = JSON.stringify(
    {
      date: d.date,
      primaryRepo: d.primaryRepo,
      totalSessions: d.totalSessions,
      subagentSessions: d.subagentSessions,
      totalTurns: d.totalTurns,
      totalToolCalls: d.totalToolCalls,
      totalAdditions: d.totalAdditions,
      totalDeletions: d.totalDeletions,
      totalFiles: d.totalFiles,
      cacheHitPct: d.cacheHitPct,
      slowestTurnSec: d.slowestTurnSec,
      errorCount: d.errorCount,
      topEditedFile: d.topEditedFile,
      topReadFile: d.topReadFile,
      projects: d.projects.slice(0, 5),
    },
    null,
    2,
  )

  const promptText = [
    "You are writing the campy 1996 Sid Meier's Civilization II High Council dialogue for a developer's daily OpenCode V2 session digest.",
    "Write one short theatrical pitch (20-38 words, addressing the user as 'Sire', 'My liege', or 'Noble Sovereign') and one <=68 char pitchTitle for each of the 6 advisors: simplifier, performance, bug-hunter, architect, user-voice, contrarian.",
    "Ground every pitch strictly in the real file names, project names, and numbers in the digest below.",
    "Reply with ONLY a valid JSON object mapping each advisor id to { \"pitchTitle\": string, \"text\": string, \"interjection\": string }.",
    "",
    summary,
  ].join("\n")

  const body = JSON.stringify({ prompt: promptText, model: { providerID, id, ...(variant ? { variant } : {}) } })
  const path = `/api/experimental/generate?directory=${encodeURIComponent(process.cwd())}`
  const p = Bun.spawn(["opencode", "api", "post", path, "--data", body], { stdout: "pipe", stderr: "pipe" })
  const out = await new Response(p.stdout).text()
  if ((await p.exited) !== 0) return base

  try {
    const text = (JSON.parse(out) as { data: { text: string } }).data.text
    const rawJson = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)
    const parsed = JSON.parse(rawJson) as Record<string, { pitchTitle?: string; text?: string; interjection?: string }>
    const nextClips = { ...base.clips }
    const nextAdvisors = base.advisors.map((adv) => {
      const custom = parsed[adv.id]
      if (!custom) return adv
      const pitchText = custom.text?.trim() || nextClips[adv.pitchClipId]?.text || ""
      nextClips[adv.pitchClipId] = synthesizeClipTiming(adv.pitchClipId, adv.id, pitchText)
      const interj = adv.interjections[0]
      if (interj && custom.interjection?.trim()) {
        nextClips[interj.clipId] = synthesizeClipTiming(interj.clipId, interj.advisorId, custom.interjection.trim())
      }
      return {
        ...adv,
        pitchTitle: custom.pitchTitle?.trim() || adv.pitchTitle,
      }
    })
    return { ...base, advisors: nextAdvisors, clips: nextClips }
  } catch {
    return base
  }
}

export async function voiceCouncilWithElevenLabs(
  council: CouncilState,
  date: string,
  outDir: string,
  apiKey: string,
): Promise<CouncilState> {
  const { mkdirSync, writeFileSync } = await import("node:fs")
  mkdirSync(outDir, { recursive: true })
  const VOICES: Record<AdvisorId, string> = {
    simplifier: "pFZP5JQG7iQjIQuC4Bku",
    performance: "pqHfZKP75CvOlQylNhV4",
    "bug-hunter": "N2lVS1w4EtoT3dr4eOWO",
    architect: "JBFqnCBsd6RMkjVDRZzb",
    "user-voice": "EXAVITQu4vr4xnSDxMaL",
    contrarian: "onwK4e9ZLuTAKqWW03F9",
  }
  const nextClips: Record<string, AudioClip> = { ...council.clips }
  for (const [clipId, clip] of Object.entries(council.clips)) {
    const voiceId = VOICES[clip.advisorId] ?? VOICES.simplifier
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        text: clip.text,
        model_id: "eleven_v4",
        voice_settings: { stability: 0.45, similarity_boost: 0.75 },
      }),
    })
    if (!res.ok) continue
    const json = (await res.json()) as {
      audio_base64: string
      alignment?: {
        characters: string[]
        character_start_times_seconds: number[]
        character_end_times_seconds: number[]
      }
    }
    const fileName = `${clipId}.mp3`
    writeFileSync(join(outDir, fileName), Buffer.from(json.audio_base64, "base64"))
    const chars = json.alignment?.characters ?? []
    const starts = json.alignment?.character_start_times_seconds ?? []
    const ends = json.alignment?.character_end_times_seconds ?? []
    const visemes: VisemeCue[] = []
    const words: WordCue[] = []
    let curWord = ""
    let wordStart = 0
    let wordEnd = 0
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i]!
      const s = Number((starts[i] ?? 0).toFixed(3))
      const e = Number((ends[i] ?? s + 0.05).toFixed(3))
      const v = charToViseme(ch, i)
      const prev = visemes[visemes.length - 1]
      if (prev && prev.v === v && Math.abs(prev.e - s) < 0.04) {
        ;(prev as { e: number }).e = e
      } else {
        visemes.push({ t: s, e, v })
      }
      if (/\s/.test(ch)) {
        if (curWord.length > 0) {
          words.push({ word: curWord, s: wordStart, e: wordEnd })
          curWord = ""
        }
      } else {
        if (curWord.length === 0) wordStart = s
        curWord += ch
        wordEnd = e
      }
    }
    if (curWord.length > 0) words.push({ word: curWord, s: wordStart, e: wordEnd })
    const duration = ends.length > 0 ? Number(ends[ends.length - 1]!.toFixed(3)) : clip.duration
    nextClips[clipId] = {
      ...clip,
      audioUrl: `/briefings/${date}/${fileName}`,
      duration,
      visemes,
      words,
    }
  }
  return { ...council, clips: nextClips }
}

export function buildCouncilFromBriefing(b: Briefing): CouncilState {
  const advisorMeta: { id: AdvisorId; name: string; icon: string; accent: string }[] = [
    { id: "simplifier", name: "Simplifier", icon: "🧹", accent: "#4aa8d8" },
    { id: "performance", name: "Performance", icon: "⚡", accent: "#f0b429" },
    { id: "bug-hunter", name: "Bug Hunter", icon: "🐛", accent: "#3dd68c" },
    { id: "architect", name: "Architect", icon: "🏛", accent: "#5c8df6" },
    { id: "user-voice", name: "User Voice", icon: "🗣", accent: "#d966a8" },
    { id: "contrarian", name: "Contrarian", icon: "😈", accent: "#e5484d" },
  ]
  const clips: Record<string, AudioClip> = {}
  const advisors: Advisor[] = advisorMeta.map((m, idx) => {
    const tr = b.transmissions[idx % Math.max(1, b.transmissions.length)]!
    const clipId = `brief-${b.id}-${m.id}`
    if (tr?.clip && tr.clip.words.length) {
      clips[clipId] = {
        id: clipId,
        advisorId: m.id,
        text: tr.script,
        audioUrl: tr.clip.url,
        duration: tr.clip.duration,
        words: tr.clip.words,
        visemes: tr.clip.mouth.map((mc, k) => ({
          t: mc.s,
          e: mc.e,
          v: mc.m === "closed" ? "closed" : (["open", "wide", "round", "fv"] as const)[k % 4]!,
        })),
      }
    } else {
      clips[clipId] = synthesizeClipTiming(clipId, m.id, tr?.script ?? "No transmission recorded.")
    }

    return {
      id: m.id,
      name: tr ? `${tr.caller.name} (${tr.caller.role})` : m.name,
      icon: m.icon,
      accent: m.accent,
      pitchClipId: clipId,
      pitchTitle: tr?.headline ?? "Daily Briefing",
      pitchExpression: tr?.priority === "urgent" ? "excited" : "neutral",
      councilReactions: {
        simplifier: "neutral",
        performance: "excited",
        "bug-hunter": "worried",
        architect: "smug",
        "user-voice": "neutral",
        contrarian: "annoyed",
      },
      interjections: [],
      evidence: {
        targetFile: tr?.caller.role ?? "Briefing",
        refLabel: b.date,
        metric: `${tr?.dossier.length ?? 0} items`,
        diffPreview: (tr?.dossier ?? []).map((d) => `• ${d.label}${d.when ? ` [${d.when}]` : ""}: ${d.detail}`).join("\n"),
        prPlanSteps: tr?.decree?.steps ? [...tr.decree.steps] : ["Approve or dismiss this briefing item"],
      },
      status: "pending",
    }
  })

  return {
    repo: `Briefing · ${b.date}`,
    branch: `${b.transmissions.length} callers`,
    advisors,
    clips,
  }
}
