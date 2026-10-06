#!/usr/bin/env bun
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { parseArgs } from "node:util"
import pkg from "../package.json"
import { builtInDemoBriefing } from "../src/briefing/demo-data"
import {
  buildCouncilFromBriefing,
  buildCouncilFromOpenCodeDay,
  DEFAULT_OPENCODE_DB,
  draftCouncilWithModel,
  extractOpenCodeDay,
  listOpenCodeDates,
  voiceCouncilWithElevenLabs,
} from "../src/opencode-council"
import { startCouncilServer } from "../src/server"

const HELP = `high-council v${pkg.version}

Summon a 1996 Civilization II High Council (or MGS1 Codec, Star Fox 64, DEFCON,
Into the Breach, and SNES Overworld skins) for your day in OpenCode V2.

Usage:
  bunx high-council [options]

Options:
  --date YYYY-MM-DD     Day of local OpenCode V2 history to inspect (default: latest active day)
  --demo                Launch with the built-in voiced fictional demo
  --from <file.json>    Load a portable CouncilState or Briefing JSON file
  --db <path>           OpenCode V2 SQLite database (default: ~/.local/share/opencode/opencode.db)
  --skin <name>         Default view: civ2 (default), codec, starfox, cabinet, defcon, breach, overworld, city
  --model <id>          Optional: refine advisor pitches via OpenCode (e.g. anthropic/claude-sonnet-4-5)
  --voice               Optional: synthesize MP3 voice tracks via ELEVENLABS_API_KEY
  --export <file.json>  Export the generated daily council & briefing JSON artifact
  --record <file.mp4>   Record a shareable MP4 clip of the council session (requires ffmpeg + playwright)
  --port <number>       HTTP port (default: 4321)
  --no-open             Start the local server without opening a browser window
  -h, --help            Show this help message
  -v, --version         Show version

Privacy & Data:
  - Your OpenCode SQLite database is opened strictly read-only (PRAGMA query_only = 1) and is never modified.
  - By default, everything runs 100% locally with zero network requests.
  - Cloud calls happen ONLY if you explicitly pass --model (uses your configured OpenCode provider)
    or --voice (sends advisor script text to ElevenLabs using ELEVENLABS_API_KEY).`

const { values } = parseArgs({
  options: {
    date: { type: "string" },
    demo: { type: "boolean", default: false },
    from: { type: "string" },
    db: { type: "string", default: process.env.HIGH_COUNCIL_DB ?? DEFAULT_OPENCODE_DB },
    skin: { type: "string", default: "civ2" },
    model: { type: "string", default: process.env.HIGH_COUNCIL_MODEL },
    voice: { type: "boolean", default: false },
    export: { type: "string" },
    record: { type: "string" },
    port: { type: "string" },
    "no-open": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
    version: { type: "boolean", short: "v", default: false },
  },
  strict: false,
})

if (values.help) {
  console.log(HELP)
  process.exit(0)
}
if (values.version) {
  console.log(pkg.version)
  process.exit(0)
}

const dbPath = String(values.db ?? DEFAULT_OPENCODE_DB)
const fromFile = values.from ? resolve(String(values.from)) : ""
if (fromFile && !existsSync(fromFile)) {
  console.error(`high-council: file not found: ${fromFile}`)
  process.exit(1)
}

let selectedDate = values.demo ? "demo" : values.date ? String(values.date) : ""
let initialBundle: NonNullable<Parameters<typeof startCouncilServer>[0]>["initialBundle"]
if (!selectedDate && !fromFile) {
  const recent = listOpenCodeDates(dbPath, 1)[0]
  selectedDate = recent?.date ?? "demo"
}

// If the user requested a specific OpenCode date (or --export / --model / --voice), prepare it now
if (selectedDate && selectedDate !== "demo" && !fromFile) {
  const digest = extractOpenCodeDay(selectedDate, dbPath)
  if (!digest) {
    if (values.date) {
      console.error(`high-council: no OpenCode V2 activity found for ${selectedDate} in ${dbPath}.`)
      const recent = listOpenCodeDates(dbPath, 5)
      if (recent.length) {
        console.error(`Recent active dates: ${recent.map((r) => `${r.date} (${r.sessions} sessions)`).join(", ")}`)
      } else {
        console.error(`Tip: run with --demo to launch the voiced fictional demo.`)
      }
      process.exit(1)
    }
    selectedDate = "demo"
  } else {
    console.log(
      `Discovered OpenCode V2 history for ${digest.date}: ${digest.totalSessions} sessions, ${digest.totalTurns} turns across ${digest.projects.length} project(s) (${digest.primaryRepo}).`,
    )
    let { council, briefing, scenario } = buildCouncilFromOpenCodeDay(digest)

    if (values.model) {
      console.log(`Drafting custom Civ II advisor pitches via ${values.model}…`)
      council = await draftCouncilWithModel(digest, council, String(values.model))
    }

    if (values.voice) {
      const apiKey = process.env.ELEVENLABS_API_KEY
      if (!apiKey) {
        console.error("high-council: --voice requires ELEVENLABS_API_KEY in the environment.")
        process.exit(1)
      }
      const audioDir = resolve(process.cwd(), ".briefings", selectedDate)
      console.log(`Synthesizing ElevenLabs advisor voices into ${audioDir}…`)
      council = await voiceCouncilWithElevenLabs(council, selectedDate, audioDir, apiKey)
      writeFileSync(resolve(audioDir, "council.json"), JSON.stringify(council, null, 2))
      writeFileSync(resolve(audioDir, "briefing.json"), JSON.stringify(briefing, null, 2))
    }

    initialBundle = { council, briefing, scenario }

    if (values.export) {
      const outPath = resolve(String(values.export))
      mkdirSync(dirname(outPath), { recursive: true })
      writeFileSync(outPath, JSON.stringify({ date: selectedDate, digest, council, briefing, scenario }, null, 2))
      console.log(`Exported daily council artifact to ${outPath}`)
      if (!values.port && !values.record) process.exit(0)
    }
  }
} else if (values.export) {
  const outPath = resolve(String(values.export))
  mkdirSync(dirname(outPath), { recursive: true })
  const council = buildCouncilFromBriefing(builtInDemoBriefing)
  writeFileSync(outPath, JSON.stringify({ date: "demo", council, briefing: builtInDemoBriefing }, null, 2))
  console.log(`Exported demo council artifact to ${outPath}`)
  if (!values.port && !values.record) process.exit(0)
}

const requestedPort = values.port ? Number(values.port) : values.record ? 0 : Number(process.env.PORT ?? 4321)
let server: ReturnType<typeof startCouncilServer>
try {
  server = startCouncilServer({
    port: requestedPort,
    dbPath,
    defaultDate: selectedDate || "demo",
    fromFile,
    initialBundle,
  })
} catch {
  // If default port 4321 is busy, pick an ephemeral free port automatically
  server = startCouncilServer({
    port: 0,
    dbPath,
    defaultDate: selectedDate || "demo",
    fromFile,
    initialBundle,
  })
}

const skin = String(values.skin ?? "civ2").toLowerCase()
const skinPath =
  skin === "civ2" || skin === "council" || skin === "default"
    ? "/"
    : `/${skin.replace(/^\//, "")}`
const query =
  fromFile
    ? "?date=custom"
    : selectedDate && selectedDate !== "demo"
      ? `?date=${encodeURIComponent(selectedDate)}&s=${encodeURIComponent(selectedDate)}`
      : ""
const url = `http://localhost:${server.port}${skinPath}${query}`

if (values.record) {
  const outMp4 = resolve(String(values.record))
  mkdirSync(dirname(outMp4), { recursive: true })
  console.log(`Recording High Council session from ${url} to ${outMp4}…`)
  const { chromium } = await import("playwright")
  const fps = 30
  const seconds = 10
  const totalFrames = fps * seconds
  const ff = Bun.spawn(
    [
      "ffmpeg",
      "-y",
      "-loglevel",
      "error",
      "-f",
      "image2pipe",
      "-framerate",
      String(fps),
      "-i",
      "-",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outMp4,
    ],
    { stdin: "pipe", stdout: "inherit", stderr: "inherit" },
  )
  const browser = await chromium.launch({
    args: ["--enable-gpu", "--enable-unsafe-webgpu", "--use-angle=metal"],
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 }, deviceScaleFactor: 1.5 })
  const sep = url.includes("?") ? "&" : "?"
  await page.goto(`${url}${sep}capture`)
  await page.waitForFunction(() => typeof (window as any).__step === "function", null, { timeout: 20000 })
  for (let f = 0; f < totalFrames; f++) {
    if (f === 15) await page.keyboard.press("1")
    if (f === 95) await page.keyboard.press("2")
    if (f === 175) await page.keyboard.press("3")
    if (f === 240) await page.keyboard.press("a")
    await page.evaluate((ms) => (window as any).__step(ms), 1000 / fps)
    ff.stdin.write(await page.screenshot({ type: "jpeg", quality: 92 }))
  }
  await browser.close()
  ff.stdin.end()
  if ((await ff.exited) !== 0) {
    console.error("high-council: ffmpeg recording failed")
    process.exit(1)
  }
  console.log(`Wrote ${outMp4}`)
  server.stop(true)
  process.exit(0)
}

console.log(`High Council listening on ${url}`)
if (!values["no-open"] && process.platform === "darwin") {
  Bun.spawn(["open", url])
}
