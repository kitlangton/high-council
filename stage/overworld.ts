import { demoScenario, type Scenario } from "./city/scenario"
import { gestures } from "./core/gestures"
import { setVirtualClock } from "./core/motion"
import { createOverworldRenderer } from "./overworld/renderer"
import { overworldSkin } from "./overworld/skin"

const params = new URLSearchParams(location.search)
if (!("gpu" in navigator)) {
  document.getElementById("fallback")!.style.display = "grid"
  throw new Error("WebGPU unavailable")
}

const name = params.get("s")
const scenario: Scenario = name ? await (await fetch(`/api/city/${name}`)).json() : demoScenario

// Load both pixel fonts before any HUD text is rasterized.
const [pixelify, silkscreen] = await Promise.all([
  new FontFace("PixelifySans", "url(/fonts/PixelifySans.ttf)", { weight: "400 700" }).load(),
  new FontFace("Silkscreen", "url(/fonts/Silkscreen-Regular.ttf)", { weight: "400 700" }).load(),
])
document.fonts.add(pixelify)
document.fonts.add(silkscreen)

const canvas = document.getElementById("c") as HTMLCanvasElement
const r = await createOverworldRenderer(canvas)
const skin = overworldSkin(r, scenario)

if (params.has("crt")) skin.toggleCrt()

const input = document.createElement("div")
input.style.cssText = "position:fixed;inset:0;z-index:1"
document.body.append(input)
gestures(input, {
  pan: (dx, dy) => skin.input.pan(dx, dy),
  wheel: (dx, dy) => skin.input.pan(-dx, -dy),
  zoom: (f, x, y) => skin.input.zoom(f, x, y),
  pinch: (f, x, y, dx, dy) => {
    skin.input.pan(dx, dy)
    skin.input.zoom(f, x, y)
  },
  tap: (x, y) => skin.input.tap(x, y),
  hover: (x, y) => skin.input.hover(x, y),
})
addEventListener("keydown", (e: KeyboardEvent) => skin.input.key(e))

const fpsEl = params.has("fps") ? Object.assign(document.createElement("div"), { id: "fps" }) : null
if (fpsEl) {
  fpsEl.style.cssText =
    "position:fixed;bottom:62px;left:18px;z-index:2;color:#fef08a;font:700 11px Silkscreen,monospace;text-shadow:1px 1px 0 #000;pointer-events:none"
  document.body.append(fpsEl)
}

let last = performance.now()
let frames = 0
let acc = 0
function step(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  skin.frame(dt, now / 1000)
  if (fpsEl) {
    frames++
    acc += dt
    if (acc > 0.5) {
      fpsEl.textContent = `${Math.round(frames / acc)} FPS · 16-BIT SNES OVERWORLD`
      frames = 0
      acc = 0
    }
  }
}

if (params.has("capture")) {
  let t = 0
  setVirtualClock(0)
  last = 0
  ;(window as any).__step = (ms: number) =>
    new Promise<void>((done) =>
      requestAnimationFrame(() => {
        t += ms
        setVirtualClock(t)
        step(t)
        r.gpu.gpu.queue.onSubmittedWorkDone().then(() => done())
      }),
    )
  ;(window as any).__skin = skin
} else {
  const tick = (now: number) => {
    step(now)
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}
