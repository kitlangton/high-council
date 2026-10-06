import { Effect, ManagedRuntime, Schema } from "effect"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, normalize } from "node:path"
import { builtInDemoBriefing } from "./briefing/demo-data"
import type { Briefing } from "./briefing/model"
import { CouncilService, type CouncilState } from "./council-service"
import { CouncilAction, type DecisionStatus, DecisionRequest } from "./domain"
import {
  buildCouncilFromBriefing,
  buildCouncilFromOpenCodeDay,
  DEFAULT_OPENCODE_DB,
  extractOpenCodeDay,
  listOpenCodeDates,
} from "./opencode-council"
import { demoScenario } from "../stage/city/scenario"
import stage from "../stage/index.html"
import cityPage from "../stage/city.html"
import defconPage from "../stage/defcon.html"
import breachPage from "../stage/breach.html"
import overworldPage from "../stage/overworld.html"

export interface ServerOptions {
  port?: number
  dbPath?: string
  defaultDate?: string
  fromFile?: string
  briefingsDir?: string
  initialBundle?: { council: CouncilState; briefing: Briefing; scenario: typeof demoScenario }
}

export function startCouncilServer(opts: ServerOptions = {}) {
  const runtime = ManagedRuntime.make(CouncilService.Live)
  const decodeDecision = Schema.decodeUnknownEffect(DecisionRequest)

  const PORT = opts.port ?? Number(process.env.PORT ?? 4321)
  const DB_PATH = opts.dbPath ?? process.env.HIGH_COUNCIL_DB ?? DEFAULT_OPENCODE_DB
  const DEFAULT_DATE = opts.defaultDate ?? process.env.HIGH_COUNCIL_DATE ?? ""
  const FROM_FILE = opts.fromFile ?? process.env.HIGH_COUNCIL_FROM ?? ""
  const PUBLIC_DIR = join(import.meta.dir, "..", "public")
  const BRIEFINGS_DIR = opts.briefingsDir ?? process.env.HIGH_COUNCIL_BRIEFINGS_DIR ?? join(process.cwd(), ".briefings")

  // Cache per-date council states and decision statuses in memory
  const councilCache = new Map<string, { council: CouncilState; briefing: Briefing; scenario: typeof demoScenario }>()
  if (opts.initialBundle) councilCache.set(DEFAULT_DATE, opts.initialBundle)
  const decisionOverrides = new Map<string, Record<string, DecisionStatus>>()

  const savedBriefingDates = (): string[] => {
    if (!existsSync(BRIEFINGS_DIR)) return []
    try {
      return readdirSync(BRIEFINGS_DIR)
        .filter((d) => /^(\d{4}-\d{2}-\d{2}|demo)$/.test(d) && existsSync(join(BRIEFINGS_DIR, d, "briefing.json")))
        .sort()
        .reverse()
    } catch {
      return []
    }
  }

  function resolveBundle(requestedDate?: string | null) {
    // 1. Explicit portable JSON file (`--from file.json`)
    if ((!requestedDate || requestedDate === "custom") && FROM_FILE && existsSync(FROM_FILE)) {
      const hit = councilCache.get("custom")
      if (hit) return { key: "custom", ...hit }
      const raw = JSON.parse(readFileSync(FROM_FILE, "utf8"))
      if (raw && raw.council && Array.isArray(raw.council.advisors)) {
        const bundle = {
          council: raw.council as CouncilState,
          briefing: (raw.briefing as Briefing) ?? builtInDemoBriefing,
          scenario: (raw.scenario as typeof demoScenario) ?? demoScenario,
        }
        councilCache.set("custom", bundle)
        return { key: "custom", ...bundle }
      }
      if (raw && Array.isArray(raw.advisors) && raw.clips) {
        const bundle = {
          council: raw as CouncilState,
          briefing: builtInDemoBriefing,
          scenario: demoScenario,
        }
        councilCache.set("custom", bundle)
        return { key: "custom", ...bundle }
      }
      if (raw && Array.isArray(raw.transmissions)) {
        const b = raw as Briefing
        const bundle = {
          council: buildCouncilFromBriefing(b),
          briefing: b,
          scenario: demoScenario,
        }
        councilCache.set("custom", bundle)
        return { key: "custom", ...bundle }
      }
    }

    const target =
      requestedDate && requestedDate !== "latest"
        ? requestedDate
        : DEFAULT_DATE ||
          savedBriefingDates()[0] ||
          listOpenCodeDates(DB_PATH, 1)[0]?.date ||
          "demo"

    if (target === "demo") {
      const demoBriefFile = join(BRIEFINGS_DIR, "demo", "briefing.json")
      const demoBrief = existsSync(demoBriefFile)
        ? (JSON.parse(readFileSync(demoBriefFile, "utf8")) as Briefing)
        : builtInDemoBriefing
      return { key: "demo", council: null, briefing: demoBrief, scenario: demoScenario }
    }

    const cached = councilCache.get(target)
    if (cached) return { key: target, ...cached }

    // 2. Check if there is an OpenCode V2 day for `target`
    if (/^\d{4}-\d{2}-\d{2}$/.test(target)) {
      const savedCouncilFile = join(BRIEFINGS_DIR, target, "council.json")
      const savedBriefFile = join(BRIEFINGS_DIR, target, "briefing.json")
      const digest = extractOpenCodeDay(target, DB_PATH)
      if (digest) {
        const built = buildCouncilFromOpenCodeDay(digest)
        const council = existsSync(savedCouncilFile)
          ? (JSON.parse(readFileSync(savedCouncilFile, "utf8")) as CouncilState)
          : built.council
        const briefing = existsSync(savedBriefFile)
          ? (JSON.parse(readFileSync(savedBriefFile, "utf8")) as Briefing)
          : built.briefing
        const bundle = { council, briefing, scenario: built.scenario }
        councilCache.set(target, bundle)
        return { key: target, ...bundle }
      }
      if (existsSync(savedBriefFile)) {
        const b = JSON.parse(readFileSync(savedBriefFile, "utf8")) as Briefing
        const council = existsSync(savedCouncilFile)
          ? (JSON.parse(readFileSync(savedCouncilFile, "utf8")) as CouncilState)
          : buildCouncilFromBriefing(b)
        const bundle = { council, briefing: b, scenario: demoScenario }
        councilCache.set(target, bundle)
        return { key: target, ...bundle }
      }
    }

    return { key: "demo", council: null, briefing: builtInDemoBriefing, scenario: demoScenario }
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: PORT,
    development: process.env.NODE_ENV !== "production",
    routes: {
      "/codec": stage,
      "/starfox": stage,
      "/cabinet": stage,
      "/city": cityPage,
      "/defcon": defconPage,
      "/breach": breachPage,
      "/overworld": overworldPage,
      "/api/briefing/:date": (req) => {
        const { briefing } = resolveBundle(req.params.date)
        return Response.json(briefing)
      },
      "/api/city/:date": (req) => {
        const { scenario } = resolveBundle(req.params.date)
        return Response.json(scenario)
      },
      "/briefings/:date/:file": (req) => {
        const { date, file } = req.params
        if (!/^(\d{4}-\d{2}-\d{2}|demo)$/.test(date) || !/^[\w.-]+\.mp3$/.test(file)) {
          return new Response("Not Found", { status: 404 })
        }
        const f = Bun.file(join(BRIEFINGS_DIR, date, file))
        return new Response(f)
      },
    },
    async fetch(req) {
      const url = new URL(req.url)

      if (url.pathname === "/api/dates" && req.method === "GET") {
        const ocDates = listOpenCodeDates(DB_PATH, 14)
        const saved = savedBriefingDates()
        return Response.json({
          defaultDate: DEFAULT_DATE || ocDates[0]?.date || saved[0] || "demo",
          hasCustomFile: Boolean(FROM_FILE && existsSync(FROM_FILE)),
          opencodeDates: ocDates,
          savedBriefings: saved,
        })
      }

      if (url.pathname === "/api/council" && req.method === "GET") {
        const dateParam = url.searchParams.get("date")
        const resolved = resolveBundle(dateParam)
        if (!resolved.council) {
          const state = await runtime.runPromise(
            Effect.gen(function* () {
              const svc = yield* CouncilService
              return yield* svc.getState()
            }),
          )
          return Response.json({ ...state, activeDate: "demo" })
        }
        const overrides = decisionOverrides.get(resolved.key) ?? {}
        return Response.json({
          ...resolved.council,
          activeDate: resolved.key,
          advisors: resolved.council.advisors.map((a) => ({
            ...a,
            status: overrides[a.id] ?? a.status,
          })),
        })
      }

      if (url.pathname === "/api/decision" && req.method === "POST") {
        const raw = (await req.json()) as { advisorId: string; action: string; date?: string }
        const dateParam = raw.date ?? url.searchParams.get("date")
        const resolved = resolveBundle(dateParam)
        if (!resolved.council) {
          const prog = Effect.gen(function* () {
            const body = yield* decodeDecision(raw)
            const svc = yield* CouncilService
            const action =
              body.action === "plan"
                ? CouncilAction.PlanPr({ advisorId: body.advisorId })
                : body.action === "dig"
                  ? CouncilAction.DigDeeper({ advisorId: body.advisorId })
                  : body.action === "dismiss"
                    ? CouncilAction.Dismiss({ advisorId: body.advisorId })
                    : CouncilAction.Reset({ advisorId: body.advisorId })
            return yield* svc.applyAction(action)
          })
          const state = await runtime.runPromise(prog)
          return Response.json({ ...state, activeDate: "demo" })
        }

        const nextStatus: DecisionStatus =
          raw.action === "plan"
            ? "planned"
            : raw.action === "dig"
              ? "investigating"
              : raw.action === "dismiss"
                ? "dismissed"
                : "pending"
        const prev = decisionOverrides.get(resolved.key) ?? {}
        prev[raw.advisorId] = nextStatus
        decisionOverrides.set(resolved.key, prev)

        return Response.json({
          ...resolved.council,
          activeDate: resolved.key,
          advisors: resolved.council.advisors.map((a) => ({
            ...a,
            status: prev[a.id] ?? a.status,
          })),
        })
      }

      const relPath = url.pathname === "/" || url.pathname === "/civ2" ? "/index.html" : url.pathname
      const safePath = normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, "")
      const file = Bun.file(join(PUBLIC_DIR, safePath))
      if (await file.exists()) {
        return new Response(file)
      }
      return new Response("Not Found", { status: 404 })
    },
  })

  return server
}

if (import.meta.main) {
  const server = startCouncilServer()
  console.log(`High Council listening on http://localhost:${server.port}`)
}
