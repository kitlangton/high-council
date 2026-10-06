import { Spring } from "./motion"

// Infinite pan/zoom camera. World units map to CSS px at zoom 1. Zoom is sprung in
// log space so flying between scales feels even.
export class Camera {
  x = new Spring(0, 9, 1)
  y = new Spring(0, 9, 1)
  logZoom = new Spring(0, 9, 1)
  w = 1
  h = 1
  private last = { x: 0, y: 0, z: 1 }
  velocity: [number, number] = [0, 0]

  get zoom() { return Math.exp(this.logZoom.x) }

  step(dt: number, w: number, h: number) {
    this.w = w; this.h = h
    this.x.step(dt); this.y.step(dt); this.logZoom.step(dt)
    const z = this.zoom
    // Screen-space velocity of the world origin under the camera, for motion blur.
    const sx = -this.x.x * z, sy = -this.y.x * z
    this.velocity = dt > 0 ? [(sx - this.last.x) / dt, (sy - this.last.y) / dt] : [0, 0]
    this.last = { x: sx, y: sy, z }
  }

  frame(cx: number, cy: number, worldW: number, worldH: number, snap = false) {
    const z = Math.min(this.w / worldW, this.h / worldH)
    if (snap) { this.x.snap(cx); this.y.snap(cy); this.logZoom.snap(Math.log(z)) }
    else { this.x.set(cx); this.y.set(cy); this.logZoom.set(Math.log(z)) }
  }

  pan(dx: number, dy: number) {
    const z = this.zoom
    this.x.snap(this.x.x - dx / z); this.y.snap(this.y.x - dy / z)
  }

  zoomAt(factor: number, sx: number, sy: number) {
    const [wx, wy] = this.toWorld(sx, sy)
    const z = Math.min(8, Math.max(0.05, this.zoom * factor))
    this.logZoom.snap(Math.log(z))
    this.x.snap(wx - (sx - this.w / 2) / z)
    this.y.snap(wy - (sy - this.h / 2) / z)
  }

  toScreen(wx: number, wy: number): [number, number] {
    const z = this.zoom
    return [(wx - this.x.x) * z + this.w / 2, (wy - this.y.x) * z + this.h / 2]
  }

  toWorld(sx: number, sy: number): [number, number] {
    const z = this.zoom
    return [(sx - this.w / 2) / z + this.x.x, (sy - this.h / 2) / z + this.y.x]
  }
}
