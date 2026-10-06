import { gestures } from "./core/gestures"
import { setVirtualClock } from "./core/motion"
import { demoScenario, type Scenario } from "./city/scenario"
import { defconSkin } from "./defcon/hud"
import { createDefconRenderer } from "./defcon/renderer"
import { buildTheater } from "./defcon/theater"

const params = new URLSearchParams(location.search)
if (!("gpu" in navigator)) {
  document.getElementById("fallback")!.style.display = "grid"
  throw new Error("WebGPU unavailable")
}

const fontMono = new FontFace("Silkscreen", "url(/fonts/Silkscreen-Regular.ttf)")
const fontSans = new FontFace("PixelifySans", "url(/fonts/PixelifySans.ttf)", { weight: "400 700" })
await Promise.all([fontMono.load(), fontSans.load()]).then(([a, b]) => {
  document.fonts.add(a)
  document.fonts.add(b)
})

const name = params.get("s")
const scenario: Scenario = name ? await (await fetch(`/api/city/${name}`)).json() : demoScenario
const seed = params.get("seed")
const theater = buildTheater(seed ? { ...scenario, seed: Number(seed) } : scenario)

const canvas = document.getElementById("c") as HTMLCanvasElement
const r = await createDefconRenderer(canvas)
const skin = defconSkin(r, theater)

if (params.get("theme") === "amber") skin.cycleTheme(1)
else if (params.get("theme") === "green") skin.cycleTheme(2)

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

let last = performance.now()
function step(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  skin.frame(dt, now / 1000)
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
