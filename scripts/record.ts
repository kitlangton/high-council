// bun run record [--date demo] [--out out.mp4] [--fps 60] [--width 1920] [--height 1080]
// Frame-exact recording: drives the stage on virtual time, screenshots every frame into
// ffmpeg, then mixes the logged voice clips and synthesized radio sounds into the track.
import { chromium } from "playwright"
import { parseArgs } from "node:util"
import { join } from "node:path"
import type { Briefing } from "../src/briefing/model"
import type { SoundEvent } from "../stage/core/voice"

const { values } = parseArgs({
  options: {
    date: { type: "string", default: "demo" },
    out: { type: "string", default: "briefing.mp4" },
    fps: { type: "string", default: "60" },
    width: { type: "string", default: "1920" },
    height: { type: "string", default: "1080" },
    port: { type: "string", default: process.env.PORT ?? "4321" },
    limit: { type: "string" },
  },
})
const fps = Number(values.fps)
const scale = 1.5
const vw = Math.round(Number(values.width) / scale), vh = Math.round(Number(values.height) / scale)
const base = `http://localhost:${values.port}`
const briefing = (await (await fetch(`${base}/api/briefing/${values.date}`)).json()) as Briefing

// Choreography, in seconds. Tune connects after 1.3 s and speech starts 0.55 s later.
type Cue = { at: number; key: string }
const cues: Cue[] = []
let t = 2.6
briefing.transmissions.forEach((tr, i) => {
  cues.push({ at: t, key: String(i + 1) })
  const speechEnd = t + 1.85 + (tr.clip?.duration ?? 6)
  cues.push({ at: speechEnd + 0.5, key: "a" })
  t = speechEnd + 1.8
})
cues.push({ at: t, key: "Escape" })
const total = values.limit ? Number(values.limit) : t + 3.2
const frames = Math.ceil(total * fps)
console.log(`${briefing.transmissions.length} transmissions · ${total.toFixed(1)}s · ${frames} frames`)

const silent = join(import.meta.dir, "..", ".scratch", "record-video.mp4")
const ff = Bun.spawn(
  ["ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
    "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", silent],
  { stdin: "pipe", stdout: "inherit", stderr: "inherit" },
)

const browser = await chromium.launch({ args: ["--enable-gpu", "--enable-unsafe-webgpu", "--use-angle=metal"] })
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: scale })
page.on("pageerror", (e) => console.log("pageerror:", e.message))
await page.goto(`${base}/codec?date=${values.date}&capture`)
await page.waitForFunction(() => typeof (window as any).__step === "function", null, { timeout: 30000 })

const dt = 1000 / fps
const started = performance.now()
let next = 0
for (let f = 0; f < frames; f++) {
  const now = f / fps
  while (next < cues.length && cues[next]!.at <= now) await page.keyboard.press(cues[next++]!.key)
  await page.evaluate((ms) => (window as any).__step(ms), dt)
  ff.stdin.write(await page.screenshot({ type: "jpeg", quality: 95 }))
  if (f % (fps * 5) === 0) console.log(`  ${(now).toFixed(0)}s · ${((performance.now() - started) / 1000).toFixed(0)}s elapsed`)
}
const sounds = (await page.evaluate(() => (window as any).__sounds)) as SoundEvent[]
await browser.close()
ff.stdin.end()
await ff.exited

// ── soundtrack ──────────────────────────────────────────────────────────────────
// Virtual time starts at the first step, so event times line up with frame times.
const RATE = 48000
const sfx = new Float32Array(Math.ceil(total * RATE))
const add = (at: number, gen: (i: number) => number, len: number) => {
  const o = Math.floor(at * RATE)
  for (let i = 0; i < len && o + i < sfx.length; i++) sfx[o + i]! += gen(i)
}
const square = (hz: number, i: number) => (Math.sin((2 * Math.PI * hz * i) / RATE) >= 0 ? 1 : -1)
for (const e of sounds) {
  if (e.kind === "chirp") for (let k = 0; k < 4; k++) {
    const len = Math.floor(0.07 * RATE)
    add(e.at + k * 0.075, (i) => square(k % 2 ? 1180 : 1560, i) * 0.12 * Math.min(1, i / 240, (len - i) / 480), len)
  } else if (e.kind === "tick") {
    const len = Math.floor(0.02 * RATE)
    add(e.at, (i) => square(2200, i) * 0.06 * (1 - i / len), len)
  } else if (e.kind === "static") {
    const len = Math.floor(0.4 * RATE)
    let a = 0, b = 0
    add(e.at, (i) => {
      const n = Math.random() * 2 - 1
      a += 0.35 * (n - a); b += 0.08 * (a - b) // crude band-pass around the hiss
      return (a - b) * 0.55 * (1 - i / len)
    }, len)
  }
}
const sfxPath = join(import.meta.dir, "..", ".scratch", "record-sfx.wav")
const wav = new DataView(new ArrayBuffer(44 + sfx.length * 2))
const str = (o: number, s: string) => [...s].forEach((c, i) => wav.setUint8(o + i, c.charCodeAt(0)))
str(0, "RIFF"); wav.setUint32(4, 36 + sfx.length * 2, true); str(8, "WAVEfmt ")
wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true)
wav.setUint32(24, RATE, true); wav.setUint32(28, RATE * 2, true); wav.setUint16(32, 2, true); wav.setUint16(34, 16, true)
str(36, "data"); wav.setUint32(40, sfx.length * 2, true)
sfx.forEach((v, i) => wav.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 32767, true))
await Bun.write(sfxPath, wav.buffer)

// Voice clips: each play becomes a delayed, trimmed input; a pause ends the previous play.
const plays: { url: string; at: number; from: number; until?: number }[] = []
for (const e of sounds.filter((s) => s.kind === "clip")) {
  const open = plays.findLast((p) => p.until === undefined)
  if (open) open.until = e.at
  if (e.url) plays.push({ url: e.url, at: e.at, from: e.from ?? 0 })
}
const inputs = plays.flatMap((p) => ["-i", join(import.meta.dir, "..", ".briefings", p.url.replace(/^\/briefings\//, ""))])
const chains = plays.map((p, i) => {
  const dur = p.until !== undefined ? `:duration=${(p.until - p.at).toFixed(3)}` : ""
  const ms = Math.round(p.at * 1000)
  return `[${i + 2}:a]atrim=start=${p.from.toFixed(3)}${dur},asetpts=PTS-STARTPTS,aresample=${RATE},adelay=${ms}|${ms}[v${i}]`
})
const mix = `[1:a]aresample=${RATE}[s];${chains.join(";")}${chains.length ? ";" : ""}[s]${plays.map((_, i) => `[v${i}]`).join("")}amix=inputs=${plays.length + 1}:normalize=0:duration=first,alimiter=limit=0.95[a]`
const out = Bun.spawn(
  ["ffmpeg", "-y", "-loglevel", "error", "-i", silent, "-i", sfxPath, ...inputs,
    "-filter_complex", mix, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", values.out!],
  { stdout: "inherit", stderr: "inherit" },
)
if ((await out.exited) !== 0) throw new Error("ffmpeg mix failed")
console.log(`Saved ${values.out} (${plays.length} voice clips, ${sounds.length - plays.length} sounds)`)
