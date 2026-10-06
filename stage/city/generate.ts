import type { District, DistrictKind, Scenario } from "./scenario"

// Procedural city: districts are carved out of an island with weighted splits that leave
// roads in the cuts, then each district fills its blocks with lots in its own style.
// Everything is boxes; the shader turns them into buildings, grass, water and roofs.

export const INSTANCE = 16
export const Shape = { box: 0, gable: 1, pyramid: 2, puff: 3 } as const
export const Mat = {
  plain: 0, ground: 1, road: 2, water: 3, building: 4, emissive: 5, plinth: 6,
  roof: 7, foliage: 8, metal: 9, sidewalk: 10, plaza: 11, glass: 12,
} as const

type RGB = [number, number, number]
export interface Box {
  x: number; y: number; z: number
  sx: number; sy: number; sz: number
  rot?: number; color: RGB; mat: number; shape?: number
  district?: number; lit?: number; emit?: number
}

export interface Placed {
  district: District
  index: number
  x0: number; z0: number; x1: number; z1: number
  color: RGB
  top: number
}
export interface Segment { ax: number; az: number; bx: number; bz: number; width: number }
export interface Crane { x: number; z: number; h: number; jib: number; angle: number; speed: number; district: number }
export interface Chimney { x: number; y: number; z: number }

export interface City {
  boxes: Float32Array
  count: number
  width: number
  depth: number
  districts: Placed[]
  roads: Segment[]
  cranes: Crane[]
  chimneys: Chimney[]
}

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const hsl = (h: number, s: number, l: number): RGB => {
  const k = (n: number) => (n + h * 12) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}
const mixc = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k]
const grey = (c: RGB, t: number): RGB => { const l = (c[0] + c[1] + c[2]) / 3; return mixc(c, [l, l, l], t) }

const PALETTE: Record<DistrictKind, { walls: RGB[]; roofs: RGB[]; ground: RGB }> = {
  downtown: {
    walls: [[0.78, 0.82, 0.86], [0.55, 0.66, 0.74], [0.86, 0.8, 0.7], [0.42, 0.5, 0.58], [0.9, 0.88, 0.84], [0.62, 0.72, 0.7]],
    roofs: [[0.36, 0.38, 0.42]], ground: [0.74, 0.72, 0.68],
  },
  residential: {
    walls: [[0.95, 0.9, 0.8], [0.93, 0.82, 0.72], [0.86, 0.88, 0.82], [0.96, 0.94, 0.9], [0.9, 0.78, 0.74], [0.8, 0.86, 0.9]],
    roofs: [[0.72, 0.36, 0.26], [0.36, 0.4, 0.48], [0.5, 0.3, 0.24], [0.3, 0.42, 0.36]], ground: [0.47, 0.62, 0.34],
  },
  industrial: {
    walls: [[0.62, 0.36, 0.28], [0.58, 0.6, 0.62], [0.7, 0.64, 0.54], [0.46, 0.5, 0.54]],
    roofs: [[0.42, 0.44, 0.46], [0.5, 0.42, 0.36]], ground: [0.56, 0.55, 0.5],
  },
  park: { walls: [[0.9, 0.86, 0.76]], roofs: [[0.5, 0.32, 0.24]], ground: [0.42, 0.62, 0.3] },
  campus: {
    walls: [[0.7, 0.42, 0.32], [0.92, 0.9, 0.84], [0.78, 0.5, 0.38]],
    roofs: [[0.32, 0.34, 0.38], [0.4, 0.28, 0.24]], ground: [0.45, 0.6, 0.33],
  },
}
const LEAVES: RGB[] = [[0.26, 0.48, 0.22], [0.34, 0.56, 0.24], [0.22, 0.42, 0.26], [0.46, 0.58, 0.22], [0.62, 0.5, 0.2]]

export function generate(s: Scenario): City {
  const r = rng(s.seed)
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!
  const boxes: number[] = []
  const add = (b: Box) => {
    boxes.push(b.x, b.y, b.z, b.shape ?? Shape.box, b.sx, b.sy, b.sz, b.rot ?? 0,
      b.color[0], b.color[1], b.color[2], b.district ?? -1, r(), b.lit ?? 0, b.emit ?? 0, b.mat)
  }

  const total = s.districts.reduce((a, d) => a + d.weight, 0)
  const side = Math.max(24, Math.round(Math.sqrt(total * 30)))
  const W = side + 2, D = Math.round(side * 0.92) + 2
  const districts: Placed[] = []
  const roads: Segment[] = []
  const cranes: Crane[] = []
  const chimneys: Chimney[] = []

  // ── island, water and plinth ──────────────────────────────────────────────────
  const M = 4
  add({ x: W / 2, y: -2.0, z: D / 2, sx: W + M * 2, sy: 1.6, sz: D + M * 2, color: [0.5, 0.44, 0.38], mat: Mat.plinth })
  add({ x: W / 2, y: -0.4, z: D / 2, sx: W + M * 2, sy: 0.06, sz: D + M * 2, color: [0.3, 0.6, 0.72], mat: Mat.water })
  add({ x: W / 2, y: -1.4, z: D / 2, sx: W + 1, sy: 1.4, sz: D + 1, color: [0.45, 0.62, 0.32], mat: Mat.ground })
  // Ring road around the land.
  const ring = [
    { ax: 0.5, az: 0.5, bx: W - 0.5, bz: 0.5 }, { ax: W - 0.5, az: 0.5, bx: W - 0.5, bz: D - 0.5 },
    { ax: W - 0.5, az: D - 0.5, bx: 0.5, bz: D - 0.5 }, { ax: 0.5, az: D - 0.5, bx: 0.5, bz: 0.5 },
  ]
  for (const g of ring) road({ ...g, width: 1 })

  function road(g: Segment) {
    roads.push(g)
    const len = Math.hypot(g.bx - g.ax, g.bz - g.az)
    const rot = Math.atan2(g.bz - g.az, g.bx - g.ax)
    add({ x: (g.ax + g.bx) / 2, y: 0, z: (g.az + g.bz) / 2, sx: len + g.width, sy: 0.03, sz: g.width * 0.92, rot: -rot, color: [0.24, 0.25, 0.27], mat: Mat.road })
  }

  // ── district layout: recursive weighted split, roads in the cuts ──────────────
  type Rect = { x0: number; z0: number; x1: number; z1: number }
  const order = [...s.districts].map((d, i) => ({ d, i })).sort((a, b) => b.d.weight - a.d.weight)
  function split(list: typeof order, rc: Rect) {
    if (list.length === 1) return place(list[0]!.d, list[0]!.i, rc)
    const sum = list.reduce((a, x) => a + x.d.weight, 0)
    let acc = 0, k = 1, best = Infinity
    for (let i = 1; i < list.length; i++) {
      acc += list[i - 1]!.d.weight
      const diff = Math.abs(acc - sum / 2)
      if (diff < best) { best = diff; k = i }
    }
    const a = list.slice(0, k), b = list.slice(k)
    const wa = a.reduce((s2, x) => s2 + x.d.weight, 0) / sum
    const w = rc.x1 - rc.x0, h = rc.z1 - rc.z0
    if (w >= h) {
      const cut = rc.x0 + Math.max(3, Math.min(w - 4, Math.round((w - 1) * wa)))
      road({ ax: cut + 0.5, az: rc.z0 - 0.5, bx: cut + 0.5, bz: rc.z1 + 0.5, width: 1 })
      split(a, { ...rc, x1: cut }); split(b, { ...rc, x0: cut + 1 })
    } else {
      const cut = rc.z0 + Math.max(3, Math.min(h - 4, Math.round((h - 1) * wa)))
      road({ ax: rc.x0 - 0.5, az: cut + 0.5, bx: rc.x1 + 0.5, bz: cut + 0.5, width: 1 })
      split(a, { ...rc, z1: cut }); split(b, { ...rc, z0: cut + 1 })
    }
  }

  function place(d: District, index: number, rc: Rect) {
    const pal = PALETTE[d.kind]
    const hue = (index * 0.137 + 0.08) % 1
    const tag = hsl(hue, 0.55, 0.52)
    const p: Placed = { district: d, index, ...rc, color: tag, top: 0 }
    districts.push(p)
    const groundColor = mixc(pal.ground, grey(pal.ground, 1), d.stale * 0.4)
    // Blocks: big districts get internal streets every ~7 tiles.
    const blocks: Rect[] = []
    const cutBlocks = (b: Rect) => {
      const w = b.x1 - b.x0, h = b.z1 - b.z0
      if (w > 9 && w >= h) {
        const c = b.x0 + Math.floor(w / 2) + (r() < 0.5 ? 0 : -1)
        road({ ax: c + 0.5, az: b.z0, bx: c + 0.5, bz: b.z1, width: 0.8 })
        cutBlocks({ ...b, x1: c }); cutBlocks({ ...b, x0: c + 1 })
      } else if (h > 9) {
        const c = b.z0 + Math.floor(h / 2) + (r() < 0.5 ? 0 : -1)
        road({ ax: b.x0, az: c + 0.5, bx: b.x1, bz: c + 0.5, width: 0.8 })
        cutBlocks({ ...b, z1: c }); cutBlocks({ ...b, z0: c + 1 })
      } else blocks.push(b)
    }
    cutBlocks(rc)

    const lots: Rect[] = []
    const maxLot = { downtown: 2, residential: 1, industrial: 3, park: 99, campus: 3 }[d.kind]
    for (const b of blocks) {
      // Sidewalk curb, then the block surface.
      add({ x: (b.x0 + b.x1) / 2, y: 0, z: (b.z0 + b.z1) / 2, sx: b.x1 - b.x0 - 0.04, sy: 0.07, sz: b.z1 - b.z0 - 0.04, color: [0.78, 0.76, 0.72], mat: Mat.sidewalk, district: index })
      const surface = d.kind === "downtown" ? Mat.plaza : Mat.ground
      add({ x: (b.x0 + b.x1) / 2, y: 0.07, z: (b.z0 + b.z1) / 2, sx: b.x1 - b.x0 - 0.3, sy: 0.02, sz: b.z1 - b.z0 - 0.3, color: d.kind === "downtown" ? pal.ground : groundColor, mat: surface, district: index })
      const bsp = (l: Rect) => {
        const w = l.x1 - l.x0, h = l.z1 - l.z0
        if ((w <= maxLot && h <= maxLot) || (w < 2 && h < 2)) return lots.push(l)
        if (w >= h) { const c = l.x0 + 1 + Math.floor(r() * (w - 1)); bsp({ ...l, x1: c }); bsp({ ...l, x0: c }) }
        else { const c = l.z0 + 1 + Math.floor(r() * (h - 1)); bsp({ ...l, z1: c }); bsp({ ...l, z0: c }) }
      }
      bsp(b)
    }

    // Construction sites for urgent work, chosen among the larger lots.
    const sites = new Set([...lots.keys()].sort(() => r() - 0.5).sort((a, b) => area(lots[b]!) - area(lots[a]!)).slice(0, Math.min(d.urgent, 3)))
    const base = 0.09
    lots.forEach((l, li) => {
      const cx = (l.x0 + l.x1) / 2, cz = (l.z0 + l.z1) / 2
      const w = l.x1 - l.x0, h = l.z1 - l.z0
      const stale = r() < d.stale * 0.6
      const wall = (c: RGB) => (stale ? shade(grey(c, 0.5), 0.8) : c)
      const lit = stale ? 0.04 : 0.25 + d.activity * 0.5
      if (sites.has(li)) return construct(cx, cz, w, h, base, index, d)
      if (stale && d.stale > 0.6 && r() < 0.35) return ruin(cx, cz, w, h, base, index)
      switch (d.kind) {
        case "downtown": {
          const ht = 0.9 + d.activity * (1.6 + Math.pow(r(), 1.6) * 8.5) * (stale ? 0.5 : 1)
          const c = wall(pick(pal.walls))
          const fw = w - 0.3, fd = h - 0.3
          const glass = r() < 0.45
          if (ht > 4 && r() < 0.65) {
            add({ x: cx, y: base, z: cz, sx: fw, sy: ht * 0.35, sz: fd, color: c, mat: Mat.building, district: index, lit })
            add({ x: cx, y: base + ht * 0.35, z: cz, sx: fw * 0.78, sy: ht * 0.45, sz: fd * 0.78, color: c, mat: glass ? Mat.glass : Mat.building, district: index, lit })
            add({ x: cx, y: base + ht * 0.8, z: cz, sx: fw * 0.5, sy: ht * 0.2, sz: fd * 0.5, color: c, mat: glass ? Mat.glass : Mat.building, district: index, lit })
          } else add({ x: cx, y: base, z: cz, sx: fw, sy: ht, sz: fd, color: c, mat: glass ? Mat.glass : Mat.building, district: index, lit })
          const topW = ht > 4 ? fw * 0.5 : fw
          for (let k = 0; k < 1 + Math.floor(r() * 2); k++)
            add({ x: cx + (r() - 0.5) * topW * 0.5, y: base + ht, z: cz + (r() - 0.5) * topW * 0.5, sx: 0.22 + r() * 0.2, sy: 0.12 + r() * 0.12, sz: 0.2 + r() * 0.2, color: [0.55, 0.56, 0.58], mat: Mat.metal, district: index })
          if (ht > 6.5) {
            add({ x: cx, y: base + ht, z: cz, sx: 0.04, sy: 1.1, sz: 0.04, color: [0.6, 0.6, 0.62], mat: Mat.metal, district: index })
            add({ x: cx, y: base + ht + 1.1, z: cz, sx: 0.09, sy: 0.09, sz: 0.09, color: [1, 0.25, 0.2], mat: Mat.emissive, district: index, emit: 1 })
          }
          p.top = Math.max(p.top, ht + base)
          if (r() < 0.3) tree(l.x0 + 0.25, l.z0 + 0.25, index, 0.6)
          break
        }
        case "residential": {
          const tall = r() < 0.3 + d.activity * 0.3
          const bh = tall ? 0.62 : 0.38
          const rot = r() < 0.5 ? 0 : Math.PI / 2
          const bw = 0.56, bd = 0.46
          const c = wall(pick(pal.walls))
          add({ x: cx, y: base, z: cz, sx: bw, sy: bh, sz: bd, rot, color: c, mat: Mat.building, district: index, lit: lit * 0.6 })
          add({ x: cx, y: base + bh, z: cz, sx: bw + 0.1, sy: 0.26, sz: bd + 0.08, rot, color: stale ? shade(pick(pal.roofs), 0.7) : pick(pal.roofs), mat: Mat.roof, shape: Shape.gable, district: index })
          if (r() < 0.5) add({ x: cx + 0.12 * (rot ? 0 : 1), y: base + bh, z: cz + 0.12 * (rot ? 1 : 0), sx: 0.07, sy: 0.32, sz: 0.07, color: [0.5, 0.36, 0.3], mat: Mat.plain, district: index })
          if (r() < 0.6 + d.stale * 0.4) tree(cx + (r() < 0.5 ? -0.36 : 0.36), cz + (r() < 0.5 ? -0.34 : 0.34), index, 0.5 + d.stale * 0.3)
          p.top = Math.max(p.top, base + bh + 0.3)
          break
        }
        case "industrial": {
          const fw = w - 0.4, fd = h - 0.4
          const bh = 0.55 + r() * 0.5
          const c = wall(pick(pal.walls))
          if (r() < 0.25 && w >= 2 && h >= 2) {
            // Tank farm.
            for (const [ox, oz] of [[-0.45, -0.45], [0.45, 0.45], [0.45, -0.45]] as const) {
              add({ x: cx + ox * (w / 2.2), y: base, z: cz + oz * (h / 2.2), sx: 0.7, sy: 0.7, sz: 0.7, rot: Math.PI / 4, color: [0.82, 0.82, 0.8], mat: Mat.metal, district: index })
              add({ x: cx + ox * (w / 2.2), y: base + 0.7, z: cz + oz * (h / 2.2), sx: 0.7, sy: 0.2, sz: 0.7, rot: Math.PI / 4, color: [0.7, 0.7, 0.68], mat: Mat.metal, shape: Shape.pyramid, district: index })
            }
            break
          }
          add({ x: cx, y: base, z: cz, sx: fw, sy: bh, sz: fd, color: c, mat: Mat.building, district: index, lit: lit * 0.3 })
          // Sawtooth roof.
          const n = Math.max(2, Math.round(fw / 0.7))
          for (let k = 0; k < n; k++)
            add({ x: cx - fw / 2 + (k + 0.5) * (fw / n), y: base + bh, z: cz, sx: fw / n, sy: 0.22, sz: fd, rot: Math.PI / 2, color: stale ? shade(pick(pal.roofs), 0.7) : pick(pal.roofs), mat: Mat.roof, shape: Shape.gable, district: index })
          if (r() < 0.7) {
            const chx = cx + fw / 2 - 0.25, chz = cz - fd / 2 + 0.25, chh = 1.6 + r() * 2.2
            add({ x: chx, y: base, z: chz, sx: 0.22, sy: chh, sz: 0.22, color: [0.6, 0.34, 0.28], mat: Mat.building, district: index })
            add({ x: chx, y: base + chh - 0.25, z: chz, sx: 0.26, sy: 0.12, sz: 0.26, color: [0.9, 0.88, 0.85], mat: Mat.plain, district: index })
            if (!stale) chimneys.push({ x: chx, y: base + chh, z: chz })
            p.top = Math.max(p.top, base + chh)
          }
          p.top = Math.max(p.top, base + bh + 0.22)
          break
        }
        case "park": {
          const area2 = w * h
          if (area2 >= 12) {
            const pw = w * 0.42, pd = h * 0.38
            add({ x: cx + w * 0.12, y: base - 0.04, z: cz - h * 0.1, sx: pw, sy: 0.05, sz: pd, color: [0.28, 0.55, 0.66], mat: Mat.water, district: index })
          }
          // Winding path.
          add({ x: cx, y: base, z: cz + h * 0.28, sx: w - 0.4, sy: 0.012, sz: 0.22, color: [0.82, 0.74, 0.58], mat: Mat.sidewalk, district: index })
          const n = Math.round(area2 * (0.9 + d.activity))
          for (let k = 0; k < n; k++) {
            const tx = l.x0 + 0.3 + r() * (w - 0.6), tz = l.z0 + 0.3 + r() * (h - 0.6)
            if (area2 >= 12 && Math.abs(tx - (cx + w * 0.12)) < w * 0.23 && Math.abs(tz - (cz - h * 0.1)) < h * 0.21) continue
            if (Math.abs(tz - (cz + h * 0.28)) < 0.2) continue
            tree(tx, tz, index, 0.7 + r() * 0.6)
          }
          // A small pavilion.
          add({ x: cx - w * 0.25, y: base, z: cz + h * 0.05, sx: 0.5, sy: 0.3, sz: 0.5, color: pal.walls[0]!, mat: Mat.building, district: index })
          add({ x: cx - w * 0.25, y: base + 0.3, z: cz + h * 0.05, sx: 0.66, sy: 0.24, sz: 0.66, color: pal.roofs[0]!, mat: Mat.roof, shape: Shape.pyramid, district: index })
          p.top = Math.max(p.top, 1.2)
          break
        }
        case "campus": {
          const fw = w - 0.5, fd = h - 0.5
          const bh = 0.6 + d.activity * 1.1 + r() * 0.5
          const c = wall(pick(pal.walls))
          const rt = stale ? shade(pick(pal.roofs), 0.7) : pick(pal.roofs)
          if (w >= 2 && h >= 2 && r() < 0.6) {
            // L-shaped hall around a lawn.
            add({ x: cx, y: base, z: l.z0 + 0.45, sx: fw, sy: bh, sz: 0.65, color: c, mat: Mat.building, district: index, lit })
            add({ x: cx, y: base + bh, z: l.z0 + 0.45, sx: fw + 0.06, sy: 0.24, sz: 0.72, rot: 0, color: rt, mat: Mat.roof, shape: Shape.gable, district: index })
            add({ x: l.x0 + 0.45, y: base, z: cz + 0.3, sx: 0.65, sy: bh, sz: fd - 0.6, color: c, mat: Mat.building, district: index, lit })
            add({ x: l.x0 + 0.45, y: base + bh, z: cz + 0.3, sx: 0.72, sy: 0.24, sz: fd - 0.55, rot: Math.PI / 2, color: rt, mat: Mat.roof, shape: Shape.gable, district: index })
            tree(cx + 0.35, cz + 0.4, index, 0.7)
            tree(cx + 0.6, cz - 0.1, index, 0.6)
          } else {
            add({ x: cx, y: base, z: cz, sx: fw, sy: bh, sz: fd * 0.7, color: c, mat: Mat.building, district: index, lit })
            add({ x: cx, y: base + bh, z: cz, sx: fw + 0.06, sy: 0.28, sz: fd * 0.7 + 0.06, color: rt, mat: Mat.roof, shape: Shape.gable, district: index })
          }
          if (stale) for (let k = 0; k < 3; k++) tree(l.x0 + 0.2 + r() * (w - 0.4), l.z0 + 0.2 + r() * (h - 0.4), index, 0.5)
          p.top = Math.max(p.top, base + bh + 0.3)
          break
        }
      }
    })
  }

  function area(l: Rect) { return (l.x1 - l.x0) * (l.z1 - l.z0) }

  function tree(x: number, z: number, district: number, scale: number) {
    const leaf = pick(LEAVES)
    const s = scale * (0.8 + r() * 0.4)
    const base = 0.09
    add({ x, y: base, z, sx: 0.06 * s, sy: 0.2 * s, sz: 0.06 * s, color: [0.4, 0.28, 0.2], mat: Mat.plain, district })
    if (r() < 0.55) {
      add({ x, y: base + 0.14 * s, z, sx: 0.42 * s, sy: 0.42 * s, sz: 0.42 * s, rot: r() * Math.PI, color: leaf, mat: Mat.foliage, shape: Shape.pyramid, district })
      add({ x, y: base + 0.4 * s, z, sx: 0.3 * s, sy: 0.34 * s, sz: 0.3 * s, rot: r() * Math.PI, color: shade(leaf, 1.08), mat: Mat.foliage, shape: Shape.pyramid, district })
    } else {
      add({ x, y: base + 0.16 * s, z, sx: 0.36 * s, sy: 0.32 * s, sz: 0.36 * s, rot: r() * Math.PI, color: leaf, mat: Mat.foliage, district })
      add({ x, y: base + 0.3 * s, z, sx: 0.24 * s, sy: 0.22 * s, sz: 0.24 * s, rot: r() * Math.PI, color: shade(leaf, 1.12), mat: Mat.foliage, district })
    }
  }

  function construct(cx: number, cz: number, w: number, h: number, base: number, index: number, d: District) {
    const fw = Math.max(0.7, w - 0.5), fd = Math.max(0.7, h - 0.5)
    const full = d.kind === "downtown" ? 3 + d.activity * 4 : 1.4
    const built = full * (0.35 + r() * 0.3)
    add({ x: cx, y: base, z: cz, sx: fw, sy: built, sz: fd, color: [0.66, 0.66, 0.64], mat: Mat.building, district: index, lit: 0.1 })
    // Scaffold frame above the finished floors.
    const top = base + built, sh = full - built
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const)
      add({ x: cx + ox * (fw / 2 + 0.03), y: top, z: cz + oz * (fd / 2 + 0.03), sx: 0.035, sy: sh, sz: 0.035, color: [0.95, 0.7, 0.18], mat: Mat.metal, district: index })
    for (let k = 1; k <= Math.floor(sh / 0.45); k++) {
      add({ x: cx, y: top + k * 0.45, z: cz - fd / 2 - 0.03, sx: fw + 0.07, sy: 0.03, sz: 0.035, color: [0.95, 0.7, 0.18], mat: Mat.metal, district: index })
      add({ x: cx, y: top + k * 0.45, z: cz + fd / 2 + 0.03, sx: fw + 0.07, sy: 0.03, sz: 0.035, color: [0.95, 0.7, 0.18], mat: Mat.metal, district: index })
    }
    const mx = cx - fw / 2 - 0.35, mz = cz + fd / 2 + 0.35
    const mh = full + 1.4
    add({ x: mx, y: base, z: mz, sx: 0.16, sy: mh, sz: 0.16, color: [0.98, 0.76, 0.16], mat: Mat.metal, district: index })
    cranes.push({ x: mx, z: mz, h: base + mh, jib: 2.4 + r(), angle: r() * Math.PI * 2, speed: (r() < 0.5 ? -1 : 1) * (0.12 + r() * 0.15), district: index })
    const p = districts[districts.length - 1]!
    p.top = Math.max(p.top, base + mh + 0.4)
  }

  function ruin(cx: number, cz: number, w: number, h: number, base: number, index: number) {
    add({ x: cx, y: base, z: cz, sx: w - 0.3, sy: 0.015, sz: h - 0.3, color: [0.52, 0.42, 0.32], mat: Mat.plain, district: index })
    for (let k = 0; k < 5; k++)
      add({ x: cx + (r() - 0.5) * (w - 0.6), y: base, z: cz + (r() - 0.5) * (h - 0.6), sx: 0.1 + r() * 0.2, sy: 0.06 + r() * 0.12, sz: 0.1 + r() * 0.2, rot: r() * 3, color: [0.6, 0.58, 0.55], mat: Mat.plain, district: index })
    for (let k = 0; k < 2; k++) tree(cx + (r() - 0.5) * (w - 0.5), cz + (r() - 0.5) * (h - 0.5), index, 0.6)
  }

  split(order, { x0: 1, z0: 1, x1: W - 1, z1: D - 1 })
  districts.sort((a, b) => a.index - b.index)

  // Shoreline trees soften the island edge.
  for (let k = 0; k < (W + D) * 0.9; k++) {
    const t = r() * 2 * (W + D)
    const [x, z] = t < W ? [t, -0.25] : t < W + D ? [W + 0.25, t - W] : t < 2 * W + D ? [t - W - D, D + 0.25] : [-0.25, t - 2 * W - D]
    tree(x, z, -1, 0.5 + r() * 0.5)
  }

  const arr = new Float32Array(boxes)
  return { boxes: arr, count: arr.length / INSTANCE, width: W, depth: D, districts, roads, cranes, chimneys }
}
