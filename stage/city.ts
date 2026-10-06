import { gestures } from "./core/gestures"
import { setVirtualClock } from "./core/motion"
import { generate } from "./city/generate"
import { createCityRenderer } from "./city/renderer"
import { demoScenario, type Scenario } from "./city/scenario"
import { citySkin, STYLES, type CityStyle } from "./city/skin"

const params = new URLSearchParams(location.search)
if (!("gpu" in navigator)) {
  document.getElementById("fallback")!.style.display = "grid"
  throw new Error("WebGPU unavailable")
}

// ?s=<name> loads a scenario from the server (for example one built from your todos).
const name = params.get("s")
const scenario: Scenario = name ? await (await fetch(`/api/city/${name}`)).json() : demoScenario
const seed = params.get("seed")
const city = generate(seed ? { ...scenario, seed: Number(seed) } : scenario)

// The pixel font must be loaded before any text is rasterized into the atlas.
const font = new FontFace("PixelifySans", "url(/fonts/PixelifySans.ttf)", { weight: "400 700" })
document.fonts.add(await font.load())

const canvas = document.getElementById("c") as HTMLCanvasElement
const r = await createCityRenderer(canvas, city)
const wanted = params.get("style") as CityStyle | null
const skin = citySkin(r, city, wanted && (STYLES as readonly string[]).includes(wanted) ? wanted : "pixel")

const input = document.createElement("div")
input.style.cssText = "position:fixed;inset:0;z-index:1"
document.body.append(input)
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
  skin.frame(dt, now / 1000)
  if (fpsEl) { frames++; acc += dt; if (acc > 0.5) { fpsEl.textContent = `${Math.round(frames / acc)} fps · ${city.count} boxes`; frames = 0; acc = 0 } }
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
