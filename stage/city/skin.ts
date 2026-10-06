import { Kind } from "../core/gpu"
import { clamp, Spring } from "../core/motion"
import { INSTANCE, Mat, Shape, type City, type Placed } from "./generate"
import { createHud, type HudButton } from "./hud"
import { MAX_DYNAMIC, MAX_SMOKE, type CityRenderer } from "./renderer"

// SimCity-style project map: an isometric island of districts. Click or tune to a district
// and the camera flies in while the rest of the city fades back.

const PITCH = (30 * Math.PI) / 180
const SANS = (w: number) => `${w} {px} -apple-system, 'SF Pro Text', system-ui, sans-serif`
const INK: [number, number, number, number] = [0.1, 0.11, 0.13, 1]
const AMBER: [number, number, number, number] = [0.96, 0.62, 0.16, 1]
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches

interface Car { seg: number; t: number; dir: number; speed: number; color: [number, number, number] }
interface Puff { x: number; y: number; z: number; age: number; life: number; spin: number }

export const STYLES = ["pixel", "macro", "dither", "riso", "ink", "blueprint"] as const
export type CityStyle = (typeof STYLES)[number]
// Post-shader mode per style; pixel has its own path.
const MODE: Record<CityStyle, number> = { macro: 0, pixel: 0, dither: 2, riso: 3, ink: 4, blueprint: 5 }

export function citySkin(r: CityRenderer, city: City, initial: CityStyle = "pixel") {
  const cam = {
    x: new Spring(city.width / 2, 5, 1), y: new Spring(0, 5, 1), z: new Spring(city.depth / 2, 5, 1),
    logZoom: new Spring(Math.log(20), 5, 1), yaw: new Spring(Math.PI / 4, 6, 1),
  }
  let yawTarget = Math.PI / 4
  let focus = -1
  let hover = -1
  let W = 1, H = 1
  const dyn = new Float32Array(MAX_DYNAMIC * INSTANCE)
  let n = 0
  const smokeData = new Float32Array(MAX_SMOKE * INSTANCE)
  let ns = 0
  const buttons: HudButton[] = []
  const hud = createHud(r.quads, () => r.dpr)

  // Style: pixel art grows its blocks in from full resolution, so switching reads as the
  // same 3D city being re-rendered rather than a cut.
  let style: CityStyle = initial
  // Pixel art lives in world space: one art pixel always covers the same patch of city,
  // so zooming in makes pixels bigger instead of revealing more detail. Zoom then steps
  // through levels where an art pixel is a whole number of screen pixels, like SimCity 2000.
  let overviewBlock = 2
  let texel = 0              // world units per art pixel, fixed once the overview is known
  const LEVELS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24]
  const pixelMix = new Spring(initial === "pixel" ? 1 : 0, 9, 1)
  const isPixel = () => style === "pixel"
  const levelZoom = (b: number) => b / texel
  const nearestLevel = (k: number, fit = false) => {
    const b = k * texel
    let best = LEVELS[0]!
    for (const l of LEVELS) if (fit ? l <= b + 1e-6 : Math.abs(Math.log(l / b)) < Math.abs(Math.log(best / b))) best = l
    return best
  }
  function stepLevel(dir: number) {
    const cur = nearestLevel(Math.exp(cam.logZoom.target))
    const i = clamp(LEVELS.indexOf(cur) + dir, 0, LEVELS.length - 1)
    const t = Math.log(levelZoom(LEVELS[i]!))
    reduced ? cam.logZoom.snap(t) : cam.logZoom.set(t)
  }
  function toggleStyle() { setStyle(STYLES[(STYLES.indexOf(style) + 1) % STYLES.length]!) }
  function setStyle(next: CityStyle) {
    style = next
    pixelMix.set(isPixel() ? 1 : 0)
    if (reduced) pixelMix.snap(pixelMix.target)
    if (isPixel() && texel) cam.logZoom.set(Math.log(levelZoom(nearestLevel(Math.exp(cam.logZoom.target)))))
  }

  // ── projection, shared with the shader ────────────────────────────────────────
  const zoom = () => Math.exp(cam.logZoom.x)
  function project(x: number, y: number, z: number, cx = cam.x.x, cy = cam.y.x, cz = cam.z.x, k = zoom(), yaw = cam.yaw.x): [number, number] {
    const dx = x - cx, dy = y - cy, dz = z - cz
    const c = Math.cos(yaw), s = Math.sin(yaw)
    const rx = dx * c - dz * s, rz = dx * s + dz * c
    return [W / 2 + rx * k, H / 2 + (rz * Math.sin(PITCH) - dy * Math.cos(PITCH)) * k]
  }
  function ground(sx: number, sy: number): [number, number] {
    const k = zoom(), c = Math.cos(cam.yaw.x), s = Math.sin(cam.yaw.x)
    const rx = (sx - W / 2) / k
    const rz = ((sy - H / 2) / k + -cam.y.x * Math.cos(PITCH)) / Math.sin(PITCH)
    return [cam.x.x + rx * c + rz * s, cam.z.x - rx * s + rz * c]
  }

  // Frame a world box: centre it and pick the zoom that fits its projected corners.
  function frameBox(x0: number, z0: number, x1: number, z1: number, top: number, fill: number, snap = false) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, cy = top * 0.35
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const x of [x0, x1]) for (const z of [z0, z1]) for (const y of [0, top]) {
      const [px, py] = project(x, y, z, cx, cy, cz, 1, yawTarget)
      minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py)
    }
    let k = Math.min((W * fill) / (maxX - minX), (H * fill) / (maxY - minY))
    if (isPixel() && texel) k = levelZoom(nearestLevel(k, true))
    const set = (s: Spring, v: number) => (snap || reduced ? s.snap(v) : s.set(v))
    set(cam.x, cx); set(cam.y, cy); set(cam.z, cz); set(cam.logZoom, Math.log(k))
  }
  function overview(snap = false) {
    // The first overview defines the art resolution: its zoom shows overviewBlock-px pixels.
    if (!texel) {
      frameBox(-4, -4, city.width + 4, city.depth + 4, 3, 0.94, true)
      texel = overviewBlock / Math.exp(cam.logZoom.x)
    }
    frameBox(-4, -4, city.width + 4, city.depth + 4, 3, 0.94, snap)
  }
  function select(i: number) {
    if (i < 0 || i >= city.districts.length) return
    focus = i
    const d = city.districts[i]!
    frameBox(d.x0 - 0.5, d.z0 - 0.5, d.x1 + 0.5, d.z1 + 0.5, Math.max(1.5, d.top), 0.62)
  }
  function back() { focus = -1; overview() }
  function rotate(dir: number) {
    yawTarget += (dir * Math.PI) / 2
    reduced ? cam.yaw.snap(yawTarget) : cam.yaw.set(yawTarget)
    focus >= 0 ? select(focus) : overview()
  }

  // ── traffic, cranes and smoke ─────────────────────────────────────────────────
  const CAR_COLORS: [number, number, number][] = [[0.78, 0.26, 0.22], [0.92, 0.91, 0.88], [0.3, 0.42, 0.62], [0.88, 0.72, 0.36], [0.32, 0.34, 0.37], [0.52, 0.62, 0.55], [0.92, 0.91, 0.88]]
  const cars: Car[] = []
  city.roads.forEach((g, seg) => {
    const len = Math.hypot(g.bx - g.ax, g.bz - g.az)
    for (let k = 0; k < Math.floor(len / 6); k++)
      cars.push({ seg, t: Math.random(), dir: Math.random() < 0.5 ? 1 : -1, speed: 0.55 + Math.random() * 0.35, color: CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)]! })
  })
  const puffs: Puff[] = []
  let puffClock = 0

  function put(x: number, y: number, z: number, sx: number, sy: number, sz: number, rot: number, color: [number, number, number], mat: number, district = -1, shape: number = Shape.box) {
    if (n >= MAX_DYNAMIC) return
    const b = n++ * INSTANCE
    dyn[b] = x; dyn[b + 1] = y; dyn[b + 2] = z; dyn[b + 3] = shape
    dyn[b + 4] = sx; dyn[b + 5] = sy; dyn[b + 6] = sz; dyn[b + 7] = rot
    dyn[b + 8] = color[0]; dyn[b + 9] = color[1]; dyn[b + 10] = color[2]; dyn[b + 11] = district
    dyn[b + 12] = 0; dyn[b + 13] = 0; dyn[b + 14] = 0; dyn[b + 15] = mat
  }

  function animate(dt: number) {
    n = 0
    ns = 0
    for (const c of cars) {
      const g = city.roads[c.seg]!
      const len = Math.hypot(g.bx - g.ax, g.bz - g.az)
      c.t = (c.t + (c.dir * c.speed * dt) / len + 1) % 1
      const ux = (g.bx - g.ax) / len, uz = (g.bz - g.az) / len
      const lane = 0.2 * g.width * c.dir
      const x = g.ax + (g.bx - g.ax) * c.t - uz * lane, z = g.az + (g.bz - g.az) * c.t + ux * lane
      const rot = -Math.atan2(uz, ux)
      put(x, 0.035, z, 0.24, 0.065, 0.12, rot, c.color, Mat.metal)
      put(x - ux * 0.015 * c.dir, 0.1, z - uz * 0.015 * c.dir, 0.13, 0.05, 0.105, rot, [0.16, 0.2, 0.26], Mat.metal)
    }
    for (const k of city.cranes) {
      k.angle += k.speed * dt * (reduced ? 0 : 1)
      const ca = Math.cos(k.angle), sa = Math.sin(k.angle)
      const yel: [number, number, number] = [0.98, 0.76, 0.16]
      put(k.x + ca * k.jib * 0.3, k.h, k.z + sa * k.jib * 0.3, k.jib * 1.4, 0.1, 0.1, -k.angle, yel, Mat.metal, k.district)
      put(k.x, k.h - 0.05, k.z, 0.26, 0.24, 0.22, -k.angle, [0.95, 0.95, 0.92], Mat.metal, k.district)
      put(k.x - ca * k.jib * 0.32, k.h - 0.12, k.z - sa * k.jib * 0.32, 0.3, 0.22, 0.24, -k.angle, [0.45, 0.46, 0.48], Mat.metal, k.district)
      const hx = k.x + ca * k.jib * 0.85, hz = k.z + sa * k.jib * 0.85
      const drop = 1.2 + Math.sin(k.angle * 3) * 0.4
      put(hx, k.h - drop, hz, 0.015, drop, 0.015, 0, [0.2, 0.2, 0.2], Mat.metal, k.district)
      put(hx, k.h - drop - 0.18, hz, 0.22, 0.16, 0.22, -k.angle, [0.75, 0.42, 0.25], Mat.building, k.district)
      put(k.x, k.h + 0.12, k.z, 0.08, 0.08, 0.08, 0, [1, 0.25, 0.2], Mat.emissive, k.district)
    }
    puffClock += dt
    if (!reduced && puffClock > 0.16) {
      puffClock = 0
      for (const c of city.chimneys) puffs.push({ x: c.x + (Math.random() - 0.5) * 0.08, y: c.y, z: c.z + (Math.random() - 0.5) * 0.08, age: 0, life: 4.5 + Math.random() * 2, spin: Math.random() })
    }
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i]!
      p.age += dt
      if (p.age > p.life) { puffs.splice(i, 1); continue }
      // Puffs rise, swell and drift downwind; they fade in quickly and out slowly.
      const t = p.age / p.life
      const s = 0.35 + Math.sqrt(t) * 1.1
      const g = 0.95 - t * 0.12
      const fade = Math.min(1, p.age * 2) * Math.pow(1 - t, 1.5) * 0.32
      if (ns >= MAX_SMOKE) continue
      const b = ns++ * INSTANCE
      const px = p.x + t * t * 1.8 + Math.sin(p.age * 1.3 + p.spin * 6) * 0.06
      smokeData.set([px, p.y + 0.1 + p.age * 0.32, p.z + t * 0.6, Shape.puff, s, s, s, 0, g, g * 0.99, g * 0.97, -1, p.spin, 0, fade, Mat.plain], b)
    }
  }

  // ── labels ────────────────────────────────────────────────────────────────────
  const q = r.quads
  function pill(text: string, x: number, y: number, o: { dot?: number[]; badge?: string; size?: number; alpha?: number }) {
    const size = o.size ?? 15
    const t = q.text(text, size, SANS(650))
    const badge = o.badge ? q.text(o.badge, size - 3, SANS(750)) : null
    const padX = 12, h = size + 16
    const w = padX * 2 + (o.dot ? 16 : 0) + t.w + (badge ? badge.w + 14 : 0)
    const x0 = x - w / 2, y0 = y - h
    const a = o.alpha ?? 1
    q.push({ x: x0, y: y0 + 3, w, h, kind: Kind.glow, glow: 8, radius: h / 2, color: [0, 0, 0, 0.25], alpha: a })
    q.push({ x: x0, y: y0, w, h, radius: h / 2, color: [1, 1, 1, 0.94], alpha: a })
    let cx = x0 + padX
    if (o.dot) { q.push({ x: cx, y: y0 + h / 2 - 5, w: 10, h: 10, radius: 5, color: [o.dot[0]!, o.dot[1]!, o.dot[2]!, 1], alpha: a }); cx += 16 }
    q.push({ x: cx, y: y0 + h / 2 - t.h / 2, w: t.w, h: t.h, kind: Kind.text, uv: t.uv, color: INK, alpha: a })
    cx += t.w + 8
    if (badge) {
      q.push({ x: cx, y: y0 + 5, w: badge.w + 8, h: h - 10, radius: (h - 10) / 2, color: AMBER, alpha: a })
      q.push({ x: cx + 4, y: y0 + h / 2 - badge.h / 2, w: badge.w, h: badge.h, kind: Kind.text, uv: badge.uv, color: [1, 1, 1, 1], alpha: a })
    }
    // A short stem down to the district.
    q.push({ x: x - 1, y: y0 + h, w: 2, h: 10, color: [1, 1, 1, 0.9], alpha: a })
    return { x0, y0, w, h }
  }

  const cardFade = new Spring(0, 12, 1)
  function card(d: Placed) {
    const a = cardFade.x
    if (a < 0.01) return
    const pad = 22, w = 380
    const title = q.text(d.district.name, 22, SANS(700))
    const sub = q.text(`${d.district.items.length} open · ${d.district.urgent} due soon`, 14, SANS(500))
    const rows = d.district.items.slice(0, 6).map((it) => ({
      t: q.text(it.title.length > 44 ? it.title.slice(0, 43) + "…" : it.title, 15, SANS(500)),
      w: it.when ? q.text(it.when, 13, SANS(650)) : null, urgent: !!it.urgent,
    }))
    const h = pad * 2 + 30 + 22 + 16 + rows.length * 34
    const x0 = W - w - 28 + (1 - a) * 24, y0 = 28
    q.push({ x: x0, y: y0 + 8, w, h, kind: Kind.glow, glow: 24, radius: 18, color: [0, 0, 0, 0.22], alpha: a })
    q.push({ x: x0, y: y0, w, h, radius: 18, color: [1, 1, 1, 0.95], alpha: a })
    q.push({ x: x0 + pad, y: y0 + pad + 8, w: 12, h: 12, radius: 6, color: [d.color[0], d.color[1], d.color[2], 1], alpha: a })
    q.push({ x: x0 + pad + 22, y: y0 + pad, w: title.w, h: title.h, kind: Kind.text, uv: title.uv, color: INK, alpha: a })
    q.push({ x: x0 + pad, y: y0 + pad + 34, w: sub.w, h: sub.h, kind: Kind.text, uv: sub.uv, color: [0.42, 0.44, 0.48, 1], alpha: a })
    let y = y0 + pad + 30 + 22 + 16
    q.push({ x: x0 + pad, y: y - 8, w: w - pad * 2, h: 1, color: [0, 0, 0, 0.08], alpha: a })
    rows.forEach((row, k) => {
      const ry = y + k * 34
      const ra = clamp(a * 1.4 - k * 0.08, 0, 1)
      q.push({ x: x0 + pad, y: ry + 12, w: 8, h: 8, radius: 4, color: row.urgent ? AMBER : [0.75, 0.77, 0.8, 1], alpha: ra })
      q.push({ x: x0 + pad + 18, y: ry + 16 - row.t.h / 2, w: row.t.w, h: row.t.h, kind: Kind.text, uv: row.t.uv, color: INK, alpha: ra })
      if (row.w) q.push({ x: x0 + w - pad - row.w.w, y: ry + 16 - row.w.h / 2, w: row.w.w, h: row.w.h, kind: Kind.text, uv: row.w.uv, color: row.urgent ? [0.8, 0.45, 0.05, 1] : [0.5, 0.52, 0.56, 1], alpha: ra })
    })
  }

  function labels() {
    q.reset()
    buttons.length = 0
    if (pixelOn()) return pixelLabels()
    const order = city.districts.map((d, i) => ({ d, i, p: project((d.x0 + d.x1) / 2, Math.max(1.2, d.top) + 0.4, (d.z0 + d.z1) / 2) })).sort((a, b) => a.p[1] - b.p[1])
    for (const { d, i, p } of order) {
      const dim = focus >= 0 && focus !== i
      const b = pill(d.district.name, p[0], p[1], {
        dot: d.color, badge: d.district.urgent ? String(d.district.urgent) : undefined,
        size: focus === i ? 17 : 14, alpha: dim ? 0.35 : hover === i || focus === i ? 1 : 0.92,
      })
      buttons.push({ x: b.x0, y: b.y0, w: b.w, h: b.h, run: () => select(i) })
    }
    cardFade.set(focus >= 0 ? 1 : 0)
    if (focus >= 0) card(city.districts[focus]!)
  }

  const pixelOn = () => pixelMix.x > 0.5

  function pixelLabels() {
    const order = city.districts.map((d, i) => ({ d, i, p: project((d.x0 + d.x1) / 2, Math.max(1.2, d.top) + 0.4, (d.z0 + d.z1) / 2) })).sort((a, b) => a.p[1] - b.p[1])
    for (const { d, i, p } of order) {
      const dim = focus >= 0 && focus !== i
      const b = hud.tag(d.district.name, d.color, d.district.urgent, p[0], p[1], dim ? 0.45 : 1, focus === i)
      buttons.push({ ...b, run: () => select(i) })
    }
    hud.frame(W, H, city, focus, buttons, {
      select, back, rotate, style: toggleStyle,
      zoom: (f) => stepLevel(f > 1 ? 1 : -1),
    })
    cardFade.set(focus >= 0 ? 1 : 0)
    if (focus >= 0) hud.card(city.districts[focus]!, W, cardFade.x)
  }

  // ── input ─────────────────────────────────────────────────────────────────────
  const pick = (sx: number, sy: number) => {
    for (const b of [...buttons].reverse()) if (sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h) return { button: b }
    const [x, z] = ground(sx, sy)
    return { district: city.districts.findIndex((d) => x >= d.x0 && x <= d.x1 && z >= d.z0 && z <= d.z1) }
  }
  const input = {
    tap(sx: number, sy: number) {
      const h = pick(sx, sy)
      if ("button" in h) return h.button!.run()
      if (h.district! >= 0 && h.district !== focus) select(h.district!)
      else back()
    },
    hover(sx: number, sy: number) { const h = pick(sx, sy); hover = "button" in h ? -1 : h.district! },
    pan(dx: number, dy: number) {
      const k = zoom(), c = Math.cos(cam.yaw.x), s = Math.sin(cam.yaw.x)
      const rx = -dx / k, rz = -dy / (k * Math.sin(PITCH))
      cam.x.snap(cam.x.x + rx * c + rz * s); cam.z.snap(cam.z.x - rx * s + rz * c)
    },
    zoom(f: number, sx: number, sy: number) {
      if (isPixel()) {
        // Wheel and pinch accumulate, then click to the next zoom level.
        wheel += Math.log(f)
        if (Math.abs(wheel) > 0.18) { stepLevel(Math.sign(wheel)); wheel = 0 }
        return
      }
      const [gx, gz] = ground(sx, sy)
      cam.logZoom.snap(clamp(cam.logZoom.x + Math.log(f), Math.log(4), Math.log(220)))
      const [nx, nz] = ground(sx, sy)
      cam.x.snap(cam.x.x + gx - nx); cam.z.snap(cam.z.x + gz - nz)
    },
    key(e: KeyboardEvent) {
      if (e.key === "Escape") back()
      else if (e.key === "q") rotate(-1)
      else if (e.key === "e") rotate(1)
      else if (e.key === "p") toggleStyle()
      else if (e.key === "[" || e.key === "]") {
        // Coarser or finer art: change world texel size, keep the current zoom level.
        const next = clamp(overviewBlock + (e.key === "]" ? 1 : -1), 2, 6)
        texel *= next / overviewBlock
        overviewBlock = next
        if (isPixel()) cam.logZoom.set(Math.log(levelZoom(nearestLevel(Math.exp(cam.logZoom.target)))))
      }
      else if (e.key === "=" || e.key === "+") isPixel() ? stepLevel(1) : cam.logZoom.set(cam.logZoom.target + 0.35)
      else if (e.key === "-") isPixel() ? stepLevel(-1) : cam.logZoom.set(cam.logZoom.target - 0.35)
      else if (e.key === "ArrowRight" || e.key === "l") select(focus < 0 ? 0 : (focus + 1) % city.districts.length)
      else if (e.key === "ArrowLeft" || e.key === "h") select(focus < 0 ? city.districts.length - 1 : (focus - 1 + city.districts.length) % city.districts.length)
      else if (e.key >= "1" && e.key <= "9") select(Number(e.key) - 1)
    },
  }

  // Macro lens: the aperture is chosen so whatever is framed stays within ~1.5 px of blur
  // and everything beyond it falls off quickly, like a 100mm lens on a model railway.
  const focusDepth = new Spring(14, 6, 1)
  let wheel = 0
  let sized = false
  let lastSize = ""
  function frame(dt: number, time: number) {
    ;[W, H] = r.size
    const size = `${W}x${H}`
    if (!sized) { sized = true; overview(true) }
    else if (size !== lastSize) focus >= 0 ? select(focus) : overview()
    lastSize = size
    cam.x.step(dt); cam.y.step(dt); cam.z.step(dt); cam.logZoom.step(dt); cam.yaw.step(dt); cardFade.step(dt)
    const fd = focus >= 0 ? (() => { const d = city.districts[focus]!; return Math.max(2, Math.hypot(d.x1 - d.x0, d.z1 - d.z0) * 0.32 + d.top * 0.45) })() : Math.hypot(city.width, city.depth) * 0.3
    focusDepth.set(fd).step(dt)
    pixelMix.step(dt)
    const px = pixelOn()
    // Art pixels grow in from full resolution when switching styles.
    const blockNow = 0.5 + (zoom() * texel - 0.5) * clamp((pixelMix.x - 0.5) * 2, 0, 1)
    // Snap the camera so the world moves in whole blocks; otherwise pixel art shimmers.
    const saved = [cam.x.x, cam.z.x]
    if (px) {
      const k0 = zoom(), c = Math.cos(cam.yaw.x), s = Math.sin(cam.yaw.x), B = Math.max(1, blockNow)
      const X = (cam.x.x * c - cam.z.x * s) * k0
      const Y = ((cam.x.x * s + cam.z.x * c) * Math.sin(PITCH) - cam.y.x * Math.cos(PITCH)) * k0
      const a = Math.round(X / B) * B / k0
      const b2 = (Math.round(Y / B) * B / k0 + cam.y.x * Math.cos(PITCH)) / Math.sin(PITCH)
      cam.x.x = a * c + b2 * s; cam.z.x = -a * s + b2 * c
    }
    animate(dt)
    labels()
    const k = zoom()
    r.render(
      { center: [cam.x.x, cam.y.x, cam.z.x], zoom: k, yaw: cam.yaw.x, pitch: PITCH, sel: focus, hover: focus >= 0 ? -1 : hover, pixel: px ? 1 : 0, block: Math.max(1, blockNow), mode: MODE[style], flat: px ? 1 : style === "macro" ? 0 : 0.8 },
      dyn, n, smokeData, ns, time, (focus >= 0 ? 1.6 : 2.4) / (k * focusDepth.x),
    )
    cam.x.x = saved[0]!; cam.z.x = saved[1]!
  }

  return { frame, input, select, back, rotate, toggleStyle, setStyle }
}
