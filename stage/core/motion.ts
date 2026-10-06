// Ported from gpu-gallery: springs integrate in fixed 1/480 s substeps so motion is
// identical at 60 and 120 Hz, and keep velocity across retargets so every gesture
// stays interruptible.
export class Spring {
  v = 0
  target: number
  constructor(public x: number, public omega = 18, public zeta = 1) {
    this.target = x
  }
  set(target: number) { this.target = target; return this }
  snap(x: number) { this.x = this.target = x; this.v = 0; return this }
  kick(x: number) { this.x = x; return this }
  step(dt: number) {
    const h = 1 / 480
    for (let t = 0; t < dt; t += h) {
      const k = Math.min(h, dt - t)
      const a = -this.omega * this.omega * (this.x - this.target) - 2 * this.zeta * this.omega * this.v
      this.v += a * k
      this.x += this.v * k
    }
    return this.x
  }
  get resting() { return Math.abs(this.x - this.target) < 0.001 && Math.abs(this.v) < 0.001 }
}

export class VelocityTracker {
  private samples: { t: number; x: number; y: number }[] = []
  add(x: number, y: number, t = clock()) {
    this.samples.push({ t, x, y })
    while (this.samples.length > 2 && t - this.samples[0]!.t > 100) this.samples.shift()
  }
  reset() { this.samples = [] }
  get velocity(): [number, number] {
    const s = this.samples
    if (s.length < 2) return [0, 0]
    const a = s[0]!, b = s[s.length - 1]!
    const dt = (b.t - a.t) / 1000
    if (dt <= 0 || clock() - b.t > 60) return [0, 0]
    return [(b.x - a.x) / dt, (b.y - a.y) / dt]
  }
}

export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

let virtual: number | null = null
export const clock = () => virtual ?? performance.now()
export const setVirtualClock = (t: number | null) => { virtual = t }
