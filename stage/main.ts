import type { Briefing } from "../src/briefing/model"
import { gestures } from "./core/gestures"
import { createRenderer } from "./core/gpu"
import { setVirtualClock } from "./core/motion"
import { cabinet } from "./skins/cabinet"
import { codec } from "./skins/codec"
import { starfox } from "./skins/starfox"

const params = new URLSearchParams(location.search)
if (params.has("capture")) (window as any).__sounds = []

// Determine active briefing skin from path or ?skin= query param
const pathName = location.pathname.replace(/^\//, "")
const skinParam = params.get("skin") ?? (pathName === "starfox" || pathName === "cabinet" ? pathName : "codec")
const activeSkinName = skinParam === "starfox" || skinParam === "cabinet" ? skinParam : "codec"

const fontMono = new FontFace("Silkscreen", "url(/fonts/Silkscreen-Regular.ttf)")
const fontSans = new FontFace("PixelifySans", "url(/fonts/PixelifySans.ttf)", { weight: "400 700" })
await Promise.all([fontMono.load(), fontSans.load()]).then(([a, b]) => {
  document.fonts.add(a)
  document.fonts.add(b)
}).catch(() => {})

const briefing: Briefing = await (await fetch(`/api/briefing/${params.get("date") ?? "latest"}`)).json()

// Without WebGPU, the same briefing renders as a plain transcript.
if (!("gpu" in navigator)) {
  const el = document.getElementById("fallback")!
  el.style.display = "block"
  for (const t of briefing.transmissions) {
    const h = document.createElement("h2")
    h.textContent = `${t.caller.frequency} · ${t.caller.name}, ${t.caller.role} — ${t.headline}`
    const p = document.createElement("p")
    p.textContent = t.script
    el.append(h, p)
    if (t.clip) el.append(Object.assign(document.createElement("audio"), { controls: true, src: t.clip.url }))
  }
  throw new Error("WebGPU unavailable")
}

const portraits = [...new Set(briefing.transmissions.map((t) => t.caller.portrait))]
const layers = new Map(portraits.map((p, i) => [p, [i * 2, i * 2 + 1] as [number, number]]))
const trial = params.get("try")
const artDir = activeSkinName === "starfox" ? "starfox" : activeSkinName === "cabinet" ? "cabinet" : "codec"
const urls = portraits.flatMap((p) =>
  trial ? [`/codec/try/${trial}.webp`, `/codec/try/${trial}.webp`] : [`/${artDir}/${p}-closed.webp`, `/${artDir}/${p}-open.webp`],
)

const canvas = document.getElementById("c") as HTMLCanvasElement
const r = await createRenderer(canvas, urls)
await r.ready
const skin =
  activeSkinName === "starfox"
    ? starfox(r, briefing, layers)
    : activeSkinName === "cabinet"
      ? cabinet(r, briefing, layers)
      : codec(r, briefing, layers)

const input = document.createElement("div")
input.style.cssText = "position:fixed;inset:0;z-index:1"
document.body.append(input)

// Minimal skin switcher pill in top-right so you can jump between Codec, Star Fox, and Cabinet
if (!params.has("capture")) {
  const nav = document.createElement("div")
  nav.style.cssText =
    "position:fixed;top:14px;right:16px;z-index:3;display:flex;gap:6px;font:600 11px ui-monospace,SFMono-Regular,Menlo,monospace;"
  const modes: [string, string][] = [
    ["", "CIV II COUNCIL"],
    ["codec", "MGS CODEC"],
    ["starfox", "STAR FOX 64"],
    ["cabinet", "CIV II WEBGL"],
  ]
  for (const [id, label] of modes) {
    const a = document.createElement("a")
    const q = new URLSearchParams(location.search)
    q.delete("skin")
    const qs = q.toString()
    a.href = `/${id}${qs ? `?${qs}` : ""}`
    const on = id !== "" && activeSkinName === id
    a.textContent = label
    a.style.cssText = `padding:5px 10px;border-radius:4px;text-decoration:none;letter-spacing:0.06em;border:1px solid ${
      on ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.18)"
    };background:${on ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.55)"};color:${on ? "#fff" : "rgba(255,255,255,0.65)"};backdrop-filter:blur(6px)`
    nav.append(a)
  }
  document.body.append(nav)
}

gestures(input, {
  pan: (dx, dy) => skin.input.pan(dx, dy),
  wheel: (dx, dy) => skin.input.pan(-dx, -dy),
  zoom: (f, x, y) => skin.input.zoom(f, x, y),
  pinch: (f, x, y, dx, dy) => { skin.input.pan(dx, dy); skin.input.zoom(f, x, y) },
  tap: (x, y) => skin.input.tap(x, y),
  hover: (x, y) => skin.input.hover(x, y),
})
addEventListener("keydown", (e: KeyboardEvent) => skin.input.key(e))

const fpsEl = params.has("fps") ? Object.assign(document.createElement("div"), { id: "fps" }) : null
if (fpsEl) document.body.append(fpsEl)
let last = performance.now(), frames = 0, acc = 0
function step(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  skin.frame(dt, now / 1000, canvas.clientWidth, canvas.clientHeight)
  r.render(now / 1000)
  if (fpsEl) { frames++; acc += dt; if (acc > 0.5) { fpsEl.textContent = `${Math.round(frames / acc)} fps · ${r.count} quads`; frames = 0; acc = 0 } }
}

if (params.has("capture")) {
  let t = 0
  setVirtualClock(0)
  last = 0
  ;(window as any).__step = (ms: number) =>
    new Promise<void>((done) => requestAnimationFrame(() => { t += ms; setVirtualClock(t); step(t); r.gpu.gpu.queue.onSubmittedWorkDone().then(() => done()) }))
  ;(window as any).__skin = skin
} else {
  const tick = (now: number) => { step(now); requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
}
