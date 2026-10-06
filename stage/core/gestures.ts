import { VelocityTracker, clock } from "./motion"

interface GestureHandlers {
  panStart?(x: number, y: number): void
  pan?(dx: number, dy: number, x: number, y: number): void
  panEnd?(vx: number, vy: number): void
  pinch?(factor: number, cx: number, cy: number, dx: number, dy: number): void
  pinchEnd?(): void
  wheel?(dx: number, dy: number, x: number, y: number): void
  zoom?(factor: number, x: number, y: number): void
  tap?(x: number, y: number): void
  hover?(x: number, y: number): void
  leave?(): void
}

// Pointer, wheel, trackpad pinch (ctrl+wheel and Safari gesture events), and touch pinch.
export function gestures(el: HTMLElement, h: GestureHandlers) {
  const pts = new Map<number, { x: number; y: number }>()
  const vel = new VelocityTracker()
  let downAt = { x: 0, y: 0, t: 0 }
  let moved = false
  let pinchDist = 0
  let pinchMid = { x: 0, y: 0 }

  const mid = () => {
    const a = [...pts.values()]
    return { x: (a[0]!.x + a[1]!.x) / 2, y: (a[0]!.y + a[1]!.y) / 2, d: Math.hypot(a[0]!.x - a[1]!.x, a[0]!.y - a[1]!.y) }
  }

  el.style.touchAction = "none"
  el.addEventListener("pointerdown", (e) => {
    el.setPointerCapture(e.pointerId)
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pts.size === 1) {
      downAt = { x: e.clientX, y: e.clientY, t: clock() }
      moved = false
      vel.reset(); vel.add(e.clientX, e.clientY)
      h.panStart?.(e.clientX, e.clientY)
    } else if (pts.size === 2) {
      const m = mid(); pinchDist = m.d; pinchMid = m; moved = true
    }
  })
  el.addEventListener("pointermove", (e) => {
    const p = pts.get(e.pointerId)
    if (!p) { if (e.pointerType === "mouse") h.hover?.(e.clientX, e.clientY); return }
    const dx = e.clientX - p.x, dy = e.clientY - p.y
    p.x = e.clientX; p.y = e.clientY
    if (pts.size === 1) {
      if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) moved = true
      vel.add(e.clientX, e.clientY)
      if (moved) h.pan?.(dx, dy, e.clientX, e.clientY)
    } else if (pts.size === 2) {
      const m = mid()
      h.pinch?.(m.d / pinchDist, m.x, m.y, m.x - pinchMid.x, m.y - pinchMid.y)
      pinchDist = m.d; pinchMid = m
    }
  })
  const up = (e: PointerEvent) => {
    if (!pts.has(e.pointerId)) return
    pts.delete(e.pointerId)
    if (pts.size === 1) {
      h.pinchEnd?.()
      const p = [...pts.values()][0]!
      vel.reset(); vel.add(p.x, p.y)
      return
    }
    if (pts.size === 0) {
      if (!moved && clock() - downAt.t < 400) { h.panEnd?.(0, 0); h.tap?.(e.clientX, e.clientY) }
      else { const [vx, vy] = vel.velocity; h.panEnd?.(vx, vy) }
    }
  }
  el.addEventListener("pointerup", up)
  el.addEventListener("pointercancel", up)
  el.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") h.leave?.() })

  el.addEventListener("wheel", (e) => {
    e.preventDefault()
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1
    if (e.ctrlKey || e.metaKey) h.zoom?.(Math.exp(-e.deltaY * k * 0.01), e.clientX, e.clientY)
    else h.wheel?.(e.deltaX * k, e.deltaY * k, e.clientX, e.clientY)
  }, { passive: false })

  // Desktop Safari trackpad pinch.
  let lastScale = 1
  el.addEventListener("gesturestart", (e: any) => { e.preventDefault(); lastScale = 1 })
  el.addEventListener("gesturechange", (e: any) => {
    e.preventDefault()
    if (pts.size >= 2) return
    h.zoom?.(e.scale / lastScale, e.clientX, e.clientY); lastScale = e.scale
  })
  el.addEventListener("gestureend", (e: any) => e.preventDefault())
}
