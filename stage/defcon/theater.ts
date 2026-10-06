import type { District, Scenario } from "../city/scenario"

// Maps a Scenario into a global DEFCON / HighFleet strategic situation board:
// 7 command sectors with procedural vector continents, coastlines, airspace boundaries,
// installations, radar domes, and ballistic/orbital tracks.

export interface Vec2 { x: number; y: number }

export interface Installation {
  x: number
  y: number
  kind: "silo" | "radar" | "airbase" | "fleet"
  label: string
  urgent: boolean
  when?: string
  itemTitle: string
}

export interface BallisticTrack {
  id: string
  from: Vec2
  to: Vec2
  ctrl: Vec2
  sectorIdx: number
  urgent: boolean
  title: string
  when: string
  code: string
  speed: number
  phase: number
  apogeeKm: number
}

export interface SectorNode {
  index: number
  code: string
  district: District
  center: Vec2
  radius: number
  defcon: 1 | 2 | 3 | 4 | 5
  coast: Vec2[]
  innerContour: Vec2[]
  shelfContour: Vec2[]
  airspace: Vec2[]
  installations: Installation[]
  radarSpeed: number
  radarPhase: number
  lat: string
  lon: string
}

export interface Theater {
  width: number
  height: number
  title: string
  defcon: 1 | 2 | 3 | 4 | 5
  sectors: SectorNode[]
  tracks: BallisticTrack[]
  bgContinents: Vec2[][]
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeCoastPolygon(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  pts: number,
  rng: () => number,
  jagged = 0.28,
  rot = 0,
): Vec2[] {
  const raw: number[] = []
  const h1 = rng() * Math.PI * 2
  const h2 = rng() * Math.PI * 2
  const h3 = rng() * Math.PI * 2
  for (let i = 0; i < pts; i++) {
    const a = (i / pts) * Math.PI * 2
    const wave =
      0.18 * Math.sin(a * 2 + h1) +
      0.12 * Math.cos(a * 3 + h2) +
      0.08 * Math.sin(a * 5 + h3) +
      (rng() - 0.5) * jagged
    raw.push(Math.max(0.42, 1 + wave))
  }
  const out: Vec2[] = []
  const c = Math.cos(rot), s = Math.sin(rot)
  for (let i = 0; i < pts; i++) {
    const r = (raw[(i - 1 + pts) % pts]! * 0.2 + raw[i]! * 0.6 + raw[(i + 1) % pts]! * 0.2)
    const a = (i / pts) * Math.PI * 2
    const lx = Math.cos(a) * rx * r
    const ly = Math.sin(a) * ry * r
    out.push({ x: cx + lx * c - ly * s, y: cy + lx * s + ly * c })
  }
  return out
}

function scalePoly(poly: Vec2[], center: Vec2, scale: number, shiftX = 0, shiftY = 0): Vec2[] {
  return poly.map((p) => ({
    x: center.x + (p.x - center.x) * scale + shiftX,
    y: center.y + (p.y - center.y) * scale + shiftY,
  }))
}

const LAYOUT: { x: number; y: number; rx: number; ry: number; rot: number; lat: string; lon: string }[] = [
  { x: 420, y: 270, rx: 138, ry: 94, rot: -0.22, lat: "54°18'N", lon: "018°42'W" },
  { x: 215, y: 485, rx: 120, ry: 84, rot: 0.31, lat: "21°04'N", lon: "074°15'W" },
  { x: 735, y: 245, rx: 146, ry: 92, rot: 0.14, lat: "61°50'N", lon: "042°10'E" },
  { x: 545, y: 555, rx: 126, ry: 82, rot: -0.18, lat: "08°12'S", lon: "011°55'E" },
  { x: 1025, y: 340, rx: 132, ry: 88, rot: -0.28, lat: "46°33'N", lon: "108°20'E" },
  { x: 865, y: 590, rx: 124, ry: 80, rot: 0.24, lat: "24°40'S", lon: "082°05'E" },
  { x: 1175, y: 615, rx: 108, ry: 72, rot: 0.35, lat: "33°15'S", lon: "149°12'E" },
]

export function buildTheater(scenario: Scenario): Theater {
  const W = 1600
  const H = 900
  const rng = mulberry32((scenario.seed || 7) * 9173 + 19)

  // Ambient polar / outer landmass silhouettes so the map feels like a full global plot
  const bgContinents: Vec2[][] = [
    makeCoastPolygon(135, 175, 110, 62, 36, rng, 0.25, -0.15),
    makeCoastPolygon(1465, 165, 125, 68, 36, rng, 0.25, 0.2),
    makeCoastPolygon(380, 755, 165, 52, 40, rng, 0.22, 0.05),
    makeCoastPolygon(1210, 780, 175, 48, 40, rng, 0.22, -0.08),
    makeCoastPolygon(745, 115, 120, 42, 32, rng, 0.24, 0.0),
  ]

  const sectors: SectorNode[] = scenario.districts.map((d, i) => {
    const slot = LAYOUT[i % LAYOUT.length]!
    const scale = 0.86 + Math.min(1.25, d.weight / 8) * 0.24
    const rx = slot.rx * scale
    const ry = slot.ry * scale
    const center = { x: slot.x, y: slot.y }

    const coast = makeCoastPolygon(center.x, center.y, rx, ry, 52, rng, 0.3, slot.rot)
    const innerContour = scalePoly(coast, center, 0.64, 4, -3)
    const shelfContour = scalePoly(coast, center, 1.18, 0, 0)

    // Octagonal tactical airspace box around the sector
    const airspace: Vec2[] = []
    const sides = 8
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2 + Math.PI / 8
      airspace.push({
        x: center.x + Math.cos(a) * (rx * 1.12),
        y: center.y + Math.sin(a) * (ry * 1.14),
      })
    }

    const installations: Installation[] = [
      {
        x: center.x,
        y: center.y,
        kind: "radar",
        label: `RDR-0${i + 1}`,
        urgent: d.urgent > 0,
        itemTitle: `${d.name} Primary Sensor Array`,
      },
    ]

    d.items.forEach((it, idx) => {
      const ang = (idx / Math.max(1, d.items.length)) * Math.PI * 2 - 0.6 + i * 0.4
      const dist = 0.36 + (idx % 2) * 0.18
      const ix = center.x + Math.cos(ang) * rx * dist
      const iy = center.y + Math.sin(ang) * ry * dist
      const kinds: Installation["kind"][] = ["silo", "airbase", "fleet", "silo"]
      installations.push({
        x: ix,
        y: iy,
        kind: it.urgent ? "silo" : kinds[idx % kinds.length]!,
        label: `${it.urgent ? "MSL" : "TRK"}-${i + 1}0${idx + 1}`,
        urgent: !!it.urgent,
        when: it.when,
        itemTitle: it.title,
      })
    })

    const defcon: 1 | 2 | 3 | 4 | 5 =
      d.urgent >= 3 ? 1 : d.urgent === 2 ? 2 : d.urgent === 1 ? 3 : d.stale > 0.6 ? 5 : 4

    return {
      index: i,
      code: `SEC-0${i + 1}`,
      district: d,
      center,
      radius: Math.max(rx, ry),
      defcon,
      coast,
      innerContour,
      shelfContour,
      airspace,
      installations,
      radarSpeed: 0.55 + d.activity * 0.85,
      radarPhase: i * 1.37,
      lat: slot.lat,
      lon: slot.lon,
    }
  })

  // Create ballistic & reconnaissance trajectories linking sectors
  const tracks: BallisticTrack[] = []
  let tIdx = 1
  sectors.forEach((sec, sIdx) => {
    sec.district.items.forEach((it, itemIdx) => {
      const inst = sec.installations[itemIdx + 1] ?? sec.installations[0]!
      // Pick a partner sector for the trajectory origin/destination
      const otherIdx = (sIdx + (it.urgent ? 2 : 3) + itemIdx) % sectors.length
      const other = sectors[otherIdx === sIdx ? (sIdx + 1) % sectors.length : otherIdx]!
      const oInst = other.installations[(itemIdx + 1) % other.installations.length] ?? other.center

      // Urgent items are inbound/active ballistic strikes converging on or launching from this sector
      const from = it.urgent ? { x: oInst.x, y: oInst.y } : { x: inst.x, y: inst.y }
      const to = it.urgent ? { x: inst.x, y: inst.y } : { x: oInst.x, y: oInst.y }
      const mx = (from.x + to.x) * 0.5
      const my = (from.y + to.y) * 0.5
      const dist = Math.hypot(to.x - from.x, to.y - from.y)
      const lift = Math.min(260, Math.max(95, dist * 0.42))
      const ctrl = { x: mx + (from.y - to.y) * 0.08, y: my - lift }

      tracks.push({
        id: `TRK-${String(tIdx++).padStart(2, "0")}`,
        from,
        to,
        ctrl,
        sectorIdx: sIdx,
        urgent: !!it.urgent,
        title: it.title,
        when: it.when ?? (it.urgent ? "IMMINENT" : "ACTIVE"),
        code: `${it.urgent ? "ICBM" : "SRT"}-${sIdx + 1}0${itemIdx + 1}`,
        speed: it.urgent ? 0.18 + (itemIdx % 3) * 0.04 : 0.09 + (itemIdx % 3) * 0.03,
        phase: (sIdx * 0.23 + itemIdx * 0.31) % 1,
        apogeeKm: Math.round(380 + dist * 0.95),
      })
    })
  })

  const totalUrgent = scenario.districts.reduce((a, d) => a + d.urgent, 0)
  const globalDefcon: 1 | 2 | 3 | 4 | 5 =
    totalUrgent >= 6 ? 1 : totalUrgent >= 3 ? 2 : totalUrgent >= 1 ? 3 : 4

  return {
    width: W,
    height: H,
    title: scenario.title.toUpperCase(),
    defcon: globalDefcon,
    sectors,
    tracks,
    bgContinents,
  }
}
