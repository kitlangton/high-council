import { gestures } from "./core/gestures"
import { setVirtualClock } from "./core/motion"
import { demoScenario, type Scenario } from "./city/scenario"
import { buildBreachBoard } from "./breach/board"
import { createBreachRenderer } from "./breach/renderer"

const params = new URLSearchParams(location.search)
if (!("gpu" in navigator)) {
  document.getElementById("fallback")!.style.display = "grid"
  throw new Error("WebGPU unavailable")
}

const name = params.get("s")
const scenario: Scenario = name ? await (await fetch(`/api/city/${name}`)).json() : demoScenario
const seed = params.get("seed")
const activeScenario = seed ? { ...scenario, seed: Number(seed) } : scenario

// Load both pixel fonts before any HUD text is rasterized into the WebGPU glyph atlas
const [pixelify, silkscreen] = await Promise.all([
  new FontFace("PixelifySans", "url(/fonts/PixelifySans.ttf)", { weight: "400 700" }).load(),
  new FontFace("Silkscreen", "url(/fonts/Silkscreen-Regular.ttf)", { weight: "400 700" }).load(),
])
document.fonts.add(pixelify)
document.fonts.add(silkscreen)

const board = buildBreachBoard(activeScenario)
const canvas = document.getElementById("c") as HTMLCanvasElement
const breach = await createBreachRenderer(canvas, board)

const initialSector = params.get("sector")
if (initialSector && Number(initialSector) >= 1 && Number(initialSector) <= 7) {
  breach.selectSector(Number(initialSector) - 1)
}

const input = document.createElement("div")
input.style.cssText = "position:fixed;inset:0;z-index:1;cursor:crosshair"
document.body.append(input)
gestures(input, {
  pan: (dx, dy) => breach.input.pan(dx, dy),
  wheel: (dx, dy) => breach.input.pan(-dx, -dy),
  zoom: (f, x, y) => breach.input.zoom(f, x, y),
  pinch: (f, x, y, dx, dy) => {
    breach.input.pan(dx, dy)
    breach.input.zoom(f, x, y)
  },
  tap: (x, y) => breach.input.tap(x, y),
  hover: (x, y) => breach.input.hover(x, y),
})
addEventListener("keydown", (e: KeyboardEvent) => breach.input.key(e))

let last = performance.now()
function step(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  breach.frame(dt, now / 1000)
}

if (params.has("capture")) {
  let t = 0
  setVirtualClock(0)
  last = 0
  ;(window as any).__step = (ms: number) =>
    new Promise<void>((done, reject) =>
      requestAnimationFrame(() => {
        try {
          t += ms
          setVirtualClock(t)
          step(t)
          breach.gpu.gpu.queue.onSubmittedWorkDone().then(() => done(), reject)
        } catch (err) {
          reject(err)
        }
      }),
    )
  ;(window as any).__breach = breach
} else {
  const tick = (now: number) => {
    step(now)
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}
