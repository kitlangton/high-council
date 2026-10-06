import { draw, effect, frame, sampler, storage, surface, target } from "vgpu"
import { createQuadLayer, initGpu } from "../core/gpu"
import { INSTANCE, type City } from "./generate"
import { postWgsl, shadowWgsl, worldWgsl } from "./shaders"

// Three passes: sun depth into a shadow map, the instanced world into an HDR target,
// then tilt-shift and grading to the screen. Labels draw last so they stay sharp.

export const MAX_DYNAMIC = 4096
export const MAX_SMOKE = 1024

export interface CamState {
  center: [number, number, number]
  zoom: number
  yaw: number
  pitch: number
  sel: number
  hover: number
  pixel: number
  block: number
  mode: number
  flat: number
}

export type CityRenderer = Awaited<ReturnType<typeof createCityRenderer>>

export async function createCityRenderer(canvas: HTMLCanvasElement, city: City) {
  const gpu = await initGpu()
  const screen = surface(gpu, canvas, { dpr: [1, 2], clearColor: [0.9, 0.88, 0.85, 1] })
  const shadow = target(gpu, { size: [3072, 3072], format: "rgba16float", depth: true, clearColor: [1, 1, 1, 1] })
  const scene = target(gpu, { size: [screen.size[0], screen.size[1]], format: "rgba16float", depth: true, clearColor: [0, 0, 0, 0] })

  const staticBuf = storage(gpu, Math.max(1, city.count) * INSTANCE * 4)
  staticBuf.write(city.boxes as Float32Array<ArrayBuffer>)
  const dynBuf = storage(gpu, MAX_DYNAMIC * INSTANCE * 4)
  const smokeBuf = storage(gpu, MAX_SMOKE * INSTANCE * 4)

  const shadowSmp = sampler(gpu, { magFilter: "nearest", minFilter: "nearest" })
  const make = (shader: string, insts: typeof staticBuf, withShadow: boolean) => {
    const d = draw(gpu, { shader, vertices: 36 })
    d.set(withShadow ? { insts, shadowMap: shadow, shadowSmp } : { insts })
    return d
  }
  const worldStatic = make(worldWgsl, staticBuf, true)
  const worldDyn = make(worldWgsl, dynBuf, true)
  const shadowStatic = make(shadowWgsl, staticBuf, false)
  const shadowDyn = make(shadowWgsl, dynBuf, false)
  // Smoke blends over the scene's colour but keeps its alpha (scene depth) and doesn't write depth.
  const smoke = draw(gpu, {
    shader: worldWgsl, vertices: 36,
    blend: { color: { src: "one", dst: "one-minus-src-alpha" }, alpha: { src: "zero", dst: "one" } },
    depth: { write: false },
  })
  smoke.set({ insts: smokeBuf, shadowMap: shadow, shadowSmp })

  const fx = effect(gpu, postWgsl)
  fx.set({ src: scene, samp: sampler(gpu, { magFilter: "linear", minFilter: "linear" }), pt: sampler(gpu, { magFilter: "nearest", minFilter: "nearest" }), post: { size: [1, 1], dpr: 1, time: 0, zoom: 1, aperture: 0, block: 1, pixel: 0, mode: 0, top: [0, 0, 0], bottom: [0, 0, 0] } })
  const quads = createQuadLayer(gpu, [])

  // Late-afternoon sun from the back left, so shadows fall toward the viewer.
  const sun = norm([-0.5, 0.78, -0.38])
  const right = norm(cross([0, 1, 0], sun))
  const up = cross(sun, right)
  const lightCenter: [number, number, number] = [city.width / 2, 0, city.depth / 2]
  const ext = Math.hypot(city.width, city.depth) * 0.62 + 4

  function render(cam: CamState, dyn: Float32Array, dynCount: number, smokeData: Float32Array, smokeCount: number, time: number, aperture: number) {
    const dpr = screen.dpr
    const W = screen.size[0] / dpr, H = screen.size[1] / dpr
    if (scene.size[0] !== screen.size[0] || scene.size[1] !== screen.size[1]) scene.resize([screen.size[0], screen.size[1]])
    if (dynCount) dynBuf.write(dyn.subarray(0, dynCount * INSTANCE) as Float32Array<ArrayBuffer>)
    if (smokeCount) smokeBuf.write(smokeData.subarray(0, smokeCount * INSTANCE) as Float32Array<ArrayBuffer>)
    const c = {
      center: cam.center, zoom: cam.zoom, viewport: [W, H], yaw: cam.yaw, pitch: cam.pitch,
      sun, time, lightRight: right, ext, lightUp: up, sel: cam.sel, lightCenter, hover: cam.hover, style: [cam.flat, 0, 0, 0],
    }
    for (const d of [worldStatic, worldDyn, shadowStatic, shadowDyn, smoke]) d.set({ cam: c })
    const p = cam.pixel
    const mixc = (a: number[], b: number[]) => a.map((v, i) => v + (b[i]! - v) * p) as [number, number, number]
    fx.set({ post: {
      size: [W, H], dpr, time, zoom: cam.zoom, aperture: cam.mode === 0 ? aperture * (1 - p) : 0, block: cam.block, pixel: p, mode: cam.mode,
      top: mixc([0.93, 0.9, 0.86], [0.2, 0.36, 0.5]), bottom: mixc([0.74, 0.8, 0.86], [0.08, 0.16, 0.26]),
    } })
    quads.prepare(W, H, dpr, time)
    frame(gpu, (f) => {
      f.pass(shadow, (p) => {
        p.draw(shadowStatic, { instances: city.count })
        if (dynCount) p.draw(shadowDyn, { instances: dynCount })
      })
      f.pass(scene, (p) => {
        p.draw(worldStatic, { instances: city.count })
        if (dynCount) p.draw(worldDyn, { instances: dynCount })
        if (smokeCount) p.draw(smoke, { instances: smokeCount })
      })
      f.pass(screen, fx)
      f.pass({ target: screen, clear: false }, (p) => quads.draw(p))
    })
  }

  return { gpu, quads, render, get size() { return [screen.size[0] / screen.dpr, screen.size[1] / screen.dpr] as const }, get dpr() { return screen.dpr } }
}

type V3 = [number, number, number]
function norm(v: V3): V3 { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l] }
function cross(a: V3, b: V3): V3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
