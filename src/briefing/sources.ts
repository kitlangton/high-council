import { existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEFAULT_OPENCODE_DB, extractOpenCodeDay, listOpenCodeDates } from "../opencode-council"

// Sources turn local context into compact plain text a briefing writer can read.
// By default, High Council reads local OpenCode V2 session history (read-only).
// External CLI/file integrations (calendar, todos, mail) are strictly opt-in via
// HIGH_COUNCIL_SOURCES=<path-to-json> so nothing is hardcoded to a specific user's setup.

export interface Window {
  readonly today: Date
  readonly days: number
}

export type Source = (w: Window) => Promise<string>

const iso = (d: Date) => d.toISOString().slice(0, 10)

async function run(cmd: string[]): Promise<string> {
  const file = join(tmpdir(), `briefing-src-${process.pid}-${Math.random().toString(36).slice(2)}.out`)
  const p = Bun.spawn(cmd, { stdout: Bun.file(file), stderr: "pipe" })
  if ((await p.exited) !== 0) throw new Error(`${cmd[0]} failed: ${await new Response(p.stderr).text()}`)
  const out = await Bun.file(file).text()
  await Bun.file(file).delete()
  return out
}

export const opencodeHistory =
  (opts: { dbPath?: string } = {}): Source =>
  async ({ today }) => {
    const dbPath = opts.dbPath ?? process.env.HIGH_COUNCIL_DB ?? DEFAULT_OPENCODE_DB
    const targetDate = iso(today)
    const digest =
      extractOpenCodeDay(targetDate, dbPath) ??
      (() => {
        const recent = listOpenCodeDates(dbPath, 1)[0]
        return recent ? extractOpenCodeDay(recent.date, dbPath) : null
      })()

    if (!digest) return "(no local OpenCode V2 activity found for this date)"

    const lines = [
      `Date: ${digest.date}`,
      `Primary repository: ${digest.primaryRepo}`,
      `Total sessions: ${digest.totalSessions} (${digest.subagentSessions} subagents), ${digest.totalTurns} turns, ${digest.totalToolCalls} tool calls`,
      `Code delta: +${digest.totalAdditions} / -${digest.totalDeletions} across ${digest.totalFiles} files`,
      `Prompt cache hit rate: ${digest.cacheHitPct}%, peak turn: ${digest.slowestTurnSec}s, tool errors: ${digest.errorCount}`,
      digest.topEditedFile
        ? `Most edited file: ${digest.topEditedFile.path} (${digest.topEditedFile.edits} edits, ${digest.topEditedFile.reads} reads)`
        : "",
      digest.topReadFile
        ? `Most read file: ${digest.topReadFile.path} (${digest.topReadFile.reads} reads)`
        : "",
      "Active projects:",
      ...digest.projects.slice(0, 6).map(
        (p) =>
          `- ${p.name}: ${p.sessions} sessions, ${p.turns} turns (+${p.additions}/-${p.deletions}), top threads: ${p.topTitles.join("; ") || "general work"}`,
      ),
    ].filter(Boolean)

    return lines.join("\n")
  }

// Optional user-configured shell command or text file source, loaded from HIGH_COUNCIL_SOURCES JSON.
export const customSource =
  (slot: string): Source =>
  async ({ today, days }) => {
    const cfgPath = process.env.HIGH_COUNCIL_SOURCES
    if (!cfgPath || !existsSync(cfgPath)) return "(no external source configured; set HIGH_COUNCIL_SOURCES to add calendar/todo/mail commands)"
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as Record<string, { command?: string[]; file?: string }>
    const entry = cfg[slot]
    if (!entry) return "(not configured)"
    if (entry.file && existsSync(entry.file)) return readFileSync(entry.file, "utf8").slice(0, 8000)
    if (entry.command?.length) {
      const cmd = entry.command.map((arg) => arg.replaceAll("{date}", iso(today)).replaceAll("{days}", String(days)))
      return (await run(cmd)).slice(0, 8000)
    }
    return "(empty source)"
  }
