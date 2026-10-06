import type { District, Scenario } from "../city/scenario"

export const WORLD_W = 512
export const WORLD_H = 320

export interface LandmarkMeta {
  readonly index: number
  readonly id: string
  readonly stageCode: string
  readonly overworldTitle: string
  readonly subtitle: string
  readonly x: number
  readonly y: number
  readonly heroOffset: [number, number]
  readonly labelOffset: [number, number]
  readonly accent: string
  readonly roofColor: string
  readonly emblem: "keep" | "windmill" | "foundry" | "star" | "cottage" | "fair" | "ghost"
}

export interface LandmarkNode extends LandmarkMeta {
  readonly district: District
}

export interface PathEdge {
  readonly from: number
  readonly to: number
  readonly points: ReadonlyArray<[number, number]>
  readonly bridgeAt?: { x: number; y: number; w: number; h: number; vertical?: boolean }
}

export const LANDMARK_META: ReadonlyArray<LandmarkMeta> = [
  {
    index: 0,
    id: "monorepo",
    stageCode: "WORLD 1-1",
    overworldTitle: "Grand Keep",
    subtitle: "Guardia Citadel · Monorepo Heights",
    x: 248,
    y: 88,
    heroOffset: [0, 22],
    labelOffset: [0, -52],
    accent: "#ef4444",
    roofColor: "#2563eb",
    emblem: "keep",
  },
  {
    index: 1,
    id: "side-projects",
    stageCode: "WORLD 1-2",
    overworldTitle: "Windmill Village",
    subtitle: "Toadstool Hills · Side Project Suburbs",
    x: 108,
    y: 128,
    heroOffset: [16, 18],
    labelOffset: [0, -34],
    accent: "#22c55e",
    roofColor: "#ef4444",
    emblem: "windmill",
  },
  {
    index: 2,
    id: "infra",
    stageCode: "WORLD 1-3",
    overworldTitle: "Magma Foundry",
    subtitle: "Vanilla Dome · Legacy Industrial Park",
    x: 382,
    y: 122,
    heroOffset: [-16, 20],
    labelOffset: [0, -40],
    accent: "#f97316",
    roofColor: "#b45309",
    emblem: "foundry",
  },
  {
    index: 3,
    id: "ideas",
    stageCode: "WORLD 1-4",
    overworldTitle: "Star Sanctuary",
    subtitle: "Forest of Illusion · Idea Gardens",
    x: 118,
    y: 222,
    heroOffset: [18, 14],
    labelOffset: [0, 32],
    accent: "#38bdf8",
    roofColor: "#fbbf24",
    emblem: "star",
  },
  {
    index: 4,
    id: "home",
    stageCode: "WORLD 1-5",
    overworldTitle: "Yoshi's Homestead",
    subtitle: "Cozy Hearth · Household Quarter",
    x: 248,
    y: 184,
    heroOffset: [0, 20],
    labelOffset: [0, 34],
    accent: "#f59e0b",
    roofColor: "#dc2626",
    emblem: "cottage",
  },
  {
    index: 5,
    id: "people",
    stageCode: "WORLD 1-6",
    overworldTitle: "Millennial Fair",
    subtitle: "Leene Square · Social Campus",
    x: 332,
    y: 230,
    heroOffset: [-14, 18],
    labelOffset: [0, 32],
    accent: "#ec4899",
    roofColor: "#a855f7",
    emblem: "fair",
  },
  {
    index: 6,
    id: "docs",
    stageCode: "WORLD 1-7",
    overworldTitle: "Sunken Ghost Ship",
    subtitle: "Haunted Reef · Old Docs Quarter",
    x: 448,
    y: 224,
    heroOffset: [-20, 14],
    labelOffset: [0, 32],
    accent: "#94a3b8",
    roofColor: "#64748b",
    emblem: "ghost",
  },
]

// Smooth a control polygon into a curved polyline using Chaikin subdivision
function smoothCurve(pts: ReadonlyArray<[number, number]>, iterations = 2): [number, number][] {
  let cur = pts.map((p) => [p[0], p[1]] as [number, number])
  for (let it = 0; it < iterations; it++) {
    if (cur.length < 3) break
    const next: [number, number][] = [cur[0]!]
    for (let i = 0; i < cur.length - 1; i++) {
      const [ax, ay] = cur[i]!
      const [bx, by] = cur[i + 1]!
      if (i > 0) next.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by])
      if (i < cur.length - 2) next.push([0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by])
    }
    next.push(cur[cur.length - 1]!)
    cur = next
  }
  return cur
}

// Overworld road network connecting the 7 landmarks via curved pixel paths and wooden bridges.
export const PATH_EDGES: ReadonlyArray<PathEdge> = [
  // 0 (Grand Keep) <-> 1 (Windmill Village): descends stairs, crosses West River Bridge below waterfall
  {
    from: 0,
    to: 1,
    points: smoothCurve([
      [248, 110],
      [248, 122],
      [216, 124],
      [186, 124],
      [152, 134],
      [124, 146],
    ]),
    bridgeAt: { x: 186, y: 124, w: 18, h: 10 },
  },
  // 0 (Grand Keep) <-> 2 (Magma Foundry): descends stairs, crosses East River Bridge below waterfall
  {
    from: 0,
    to: 2,
    points: smoothCurve([
      [248, 110],
      [248, 122],
      [280, 124],
      [304, 124],
      [338, 132],
      [366, 142],
    ]),
    bridgeAt: { x: 298, y: 124, w: 18, h: 10 },
  },
  // 0 (Grand Keep) <-> 4 (Yoshi's Homestead): straight down central royal highway & creek bridge
  {
    from: 0,
    to: 4,
    points: [
      [248, 110],
      [248, 136],
      [248, 162],
      [248, 204],
    ],
    bridgeAt: { x: 248, y: 146, w: 12, h: 18, vertical: true },
  },
  // 1 (Windmill Village) <-> 3 (Star Sanctuary)
  {
    from: 1,
    to: 3,
    points: smoothCurve([
      [124, 146],
      [110, 174],
      [114, 206],
      [136, 236],
    ]),
  },
  // 1 (Windmill Village) <-> 4 (Yoshi's Homestead)
  {
    from: 1,
    to: 4,
    points: smoothCurve([
      [124, 146],
      [162, 168],
      [204, 188],
      [248, 204],
    ]),
    bridgeAt: { x: 182, y: 178, w: 18, h: 10 },
  },
  // 3 (Star Sanctuary) <-> 4 (Yoshi's Homestead)
  {
    from: 3,
    to: 4,
    points: smoothCurve([
      [136, 236],
      [174, 232],
      [212, 220],
      [248, 204],
    ]),
    bridgeAt: { x: 174, y: 232, w: 18, h: 10 },
  },
  // 4 (Yoshi's Homestead) <-> 2 (Magma Foundry)
  {
    from: 4,
    to: 2,
    points: smoothCurve([
      [248, 204],
      [292, 188],
      [334, 166],
      [366, 142],
    ]),
  },
  // 4 (Yoshi's Homestead) <-> 5 (Millennial Fair)
  {
    from: 4,
    to: 5,
    points: smoothCurve([
      [248, 204],
      [274, 226],
      [296, 240],
      [318, 248],
    ]),
  },
  // 2 (Magma Foundry) <-> 5 (Millennial Fair)
  {
    from: 2,
    to: 5,
    points: smoothCurve([
      [366, 142],
      [356, 178],
      [340, 214],
      [318, 248],
    ]),
  },
  // 5 (Millennial Fair) <-> 6 (Sunken Ghost Ship)
  {
    from: 5,
    to: 6,
    points: smoothCurve([
      [318, 248],
      [358, 252],
      [394, 246],
      [428, 238],
    ]),
    bridgeAt: { x: 394, y: 246, w: 26, h: 10 },
  },
]

export function buildLandmarks(scenario: Scenario): LandmarkNode[] {
  return LANDMARK_META.map((meta, i) => {
    const district =
      scenario.districts.find((d) => d.id === meta.id) ??
      scenario.districts[i] ??
      scenario.districts[0]!
    return { ...meta, district }
  })
}

// Compute shortest polyline of waypoints along PATH_EDGES from node A to node B.
export function findPathWaypoints(fromIdx: number, toIdx: number): [number, number][] {
  if (fromIdx === toIdx) {
    const m = LANDMARK_META[fromIdx]!
    return [[m.x + m.heroOffset[0], m.y + m.heroOffset[1]]]
  }
  const adj = new Map<number, { to: number; pts: [number, number][] }[]>()
  for (let i = 0; i < LANDMARK_META.length; i++) adj.set(i, [])
  for (const e of PATH_EDGES) {
    const fwd = e.points.map((p) => [p[0], p[1]] as [number, number])
    const rev = [...fwd].reverse()
    adj.get(e.from)!.push({ to: e.to, pts: fwd })
    adj.get(e.to)!.push({ to: e.from, pts: rev })
  }

  // BFS for shortest hop path
  const queue: number[] = [fromIdx]
  const prev = new Map<number, { parent: number; pts: [number, number][] }>()
  const visited = new Set<number>([fromIdx])
  while (queue.length > 0) {
    const cur = queue.shift()!
    if (cur === toIdx) break
    for (const edge of adj.get(cur) ?? []) {
      if (!visited.has(edge.to)) {
        visited.add(edge.to)
        prev.set(edge.to, { parent: cur, pts: edge.pts })
        queue.push(edge.to)
      }
    }
  }

  const segments: [number, number][][] = []
  let cur = toIdx
  while (cur !== fromIdx && prev.has(cur)) {
    const step = prev.get(cur)!
    segments.unshift(step.pts)
    cur = step.parent
  }

  const out: [number, number][] = []
  for (const seg of segments) {
    for (const pt of seg) {
      const last = out[out.length - 1]
      if (!last || last[0] !== pt[0] || last[1] !== pt[1]) {
        out.push(pt)
      }
    }
  }
  // Densify waypoints so the hero walks smoothly at constant speed
  const dense: [number, number][] = []
  for (let i = 0; i < out.length - 1; i++) {
    const [ax, ay] = out[i]!
    const [bx, by] = out[i + 1]!
    const dist = Math.hypot(bx - ax, by - ay)
    const steps = Math.max(1, Math.ceil(dist / 2))
    for (let s = 0; s < steps; s++) {
      const t = s / steps
      dense.push([ax + (bx - ax) * t, ay + (by - ay) * t])
    }
  }
  if (out.length > 0) dense.push(out[out.length - 1]!)
  return dense
}
