import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { chromium } from "playwright"

const dir = mkdtempSync(join(tmpdir(), "high-council-consumer-"))
let child: ReturnType<typeof Bun.spawn> | undefined
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined

async function run(command: string[], cwd = dir) {
  const proc = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe", timeout: 60000 })
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  if (await proc.exited !== 0) throw new Error(`${command[0]} failed: ${stderr}`)
  return stdout
}

try {
  const packed = JSON.parse(await run(["npm", "pack", "--json", "--ignore-scripts", "--pack-destination", dir], process.cwd()))
  writeFileSync(join(dir, "package.json"), '{"name":"clean-consumer","private":true}')
  await run(["bun", "add", join(dir, packed[0].filename)])

  const dbPath = join(dir, "fixture.db")
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE session_v2 (id TEXT, parent_id TEXT, directory TEXT, title TEXT, model TEXT,
      summary_additions INTEGER, summary_deletions INTEGER, summary_files INTEGER,
      cost REAL, tokens_input INTEGER, tokens_cache_read INTEGER, time_updated INTEGER);
    CREATE TABLE session_message (session_id TEXT, type TEXT, time_created INTEGER, data TEXT);
  `)
  const ts = new Date(2026, 9, 5, 12).getTime()
  db.run("INSERT INTO session_v2 VALUES (?, NULL, ?, ?, ?, 12, 3, 1, 0.1, 100, 400, ?)",
    ["fictional-session", join(dir, "sample-app"), "Fix settings keyboard navigation", '{"id":"fictional-model"}', ts])
  db.run("INSERT INTO session_message VALUES (?, ?, ?, ?)", ["fictional-session", "assistant", ts,
    JSON.stringify({ time: { completed: ts + 1000 }, content: [{ type: "tool", name: "edit", state: { status: "completed", input: { filePath: join(dir, "sample-app/src/settings.ts") } } }] })])
  db.close()
  const bin = join(dir, "node_modules/.bin/high-council")
  await run(["bun", bin, "--date", "2026-10-05", "--db", dbPath, "--export", "daily.json"])
  const artifact = await Bun.file(join(dir, "daily.json")).json()
  if (artifact.digest.totalSessions !== 1 || artifact.digest.primaryRepo !== "sample-app") throw new Error("Daily extraction failed")

  // Inject markup into supplied data to prove the UI treats it as text, not HTML.
  artifact.council.advisors[0].pitchTitle = '<img src=x onerror="window.injected=true">'
  writeFileSync(join(dir, "daily.json"), JSON.stringify(artifact))
  const launched = Bun.spawn(["bun", bin, "--from", "daily.json", "--port", "0", "--no-open", "--db", dbPath], { cwd: dir, stdout: "pipe", stderr: "pipe", timeout: 60000 })
  child = launched
  let output = ""
  for await (const chunk of launched.stdout) {
    output += new TextDecoder().decode(chunk)
    if (/http:\/\/localhost:\d+/.test(output)) break
  }
  const port = output.match(/http:\/\/localhost:(\d+)/)?.[1]
  if (!port) throw new Error("Installed CLI did not launch")
  const base = `http://127.0.0.1:${port}`
  const served = await (await fetch(`${base}/api/council?date=custom`)).json()
  if (served.repo !== artifact.council.repo) throw new Error("Export/import round trip failed")
  for (const route of ["/", "/codec", "/starfox", "/cabinet", "/defcon", "/breach", "/overworld", "/api/briefing/custom"]) {
    const response = await fetch(base + route)
    if (!response.ok) throw new Error(`Route failed: ${route}`)
  }
  browser = await chromium.launch()
  const page = await browser.newPage()
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  await page.goto(`${base}/?date=custom`)
  await page.locator(".advisor-card").first().waitFor()
  if (await page.locator(".advisor-card").count() !== 6) throw new Error("Missing advisors")
  if (await page.evaluate(() => "injected" in window)) throw new Error("Data executed as HTML")
  await page.click("#btn-plan")
  await page.locator(".plan-list.visible").waitFor()
  await page.click(".advisor-card:first-child")
  await page.locator(".advisor-card.speaking").waitFor()
  if (errors.length) throw new Error(errors.join("\n"))
  if (process.env.HIGH_COUNCIL_CHECK_RECORD === "1") {
    await browser.close()
    browser = undefined
    await run(["bun", bin, "--demo", "--db", dbPath, "--record", "preview.mp4", "--no-open"])
    if (Bun.file(join(dir, "preview.mp4")).size < 1000) throw new Error("Recording was empty")
    console.log("Installed CLI: experimental silent MP4 recording passed.")
  }
  console.log("Clean installed CLI: daily extraction, JSON round trip, routes, speaking, decisions, and safe text rendering passed.")
} finally {
  await browser?.close()
  child?.kill()
  if (child) await child.exited
  rmSync(resolve(dir), { recursive: true, force: true })
}
