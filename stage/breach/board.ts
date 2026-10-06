import type { District, DistrictKind, Scenario } from "../city/scenario"

export type TerrainKind =
  | "water"
  | "acid"
  | "grass"
  | "forest"
  | "mountain"
  | "road"
  | "plaza"
  | "industrial"
  | "ruin"

export type BuildingStyle =
  | "hq-spire"
  | "sky-twin"
  | "data-tower"
  | "suburb-cottages"
  | "suburb-studio"
  | "foundry-stacks"
  | "reactor-dome"
  | "biodome"
  | "botanical- conservatory"
  | "apartments"
  | "hearth-block"
  | "comms-dish"
  | "campus-hall"
  | "ruin-archive"
  | "ruin-monolith"

export type MechKind = "prime" | "siege" | "science" | "tank" | "jet"

export type VekKind = "alpha-hornet" | "firebug" | "scarab" | "crab" | "beetle" | "psion" | "scorpion"

export interface MechUnit {
  readonly id: string
  readonly name: string
  readonly pilot: string
  readonly kind: MechKind
  readonly gx: number
  readonly gy: number
  readonly hp: number
  readonly maxHp: number
  readonly move: number
  readonly weapon: string
  readonly districtIndex: number
}

export interface VekThreat {
  readonly id: string
  readonly name: string
  readonly kind: VekKind
  readonly fromGx: number
  readonly fromGy: number
  readonly targetGx: number
  readonly targetGy: number
  readonly districtIndex: number
  readonly itemIndex: number
  readonly title: string
  readonly when: string
  readonly gridDamage: number
  readonly hp: number
}

export interface BoardTile {
  readonly gx: number
  readonly gy: number
  readonly terrain: TerrainKind
  readonly elevation: number // in art pixels (-3 for water/acid, 0 for ground, +2 for highland)
  readonly districtIndex: number | null // 0..6 if part of a sector
  readonly building: BuildingStyle | null
  readonly buildingLabel?: string
  readonly powerBars: number // 0..3 yellow grid bars
  readonly defenseStars: number // 1..4
  readonly coordLabel: string // e.g. "D4"
}

export interface SectorInfo {
  readonly index: number
  readonly district: District
  readonly code: string // e.g. "SEC-01"
  readonly corpName: string
  readonly color: string
  readonly accentRgb: [number, number, number]
  readonly tiles: BoardTile[]
  readonly centerGx: number
  readonly centerGy: number
  readonly powerGridMw: number
  readonly defenseStars: number
  readonly threats: VekThreat[]
  readonly mechs: MechUnit[]
}

export interface BreachBoard {
  readonly scenario: Scenario
  readonly size: 8
  readonly tiles: BoardTile[] // 64 tiles
  readonly grid: BoardTile[][] // [gx][gy]
  readonly sectors: SectorInfo[]
  readonly mechs: MechUnit[]
  readonly threats: VekThreat[]
  readonly gridPowerPercent: number
  readonly gridBlocksFilled: number
  readonly gridBlocksTotal: number
  readonly shieldResistPercent: number
}

const SECTOR_THEMES: Record<DistrictKind, { corp: string; color: string; rgb: [number, number, number]; stars: number }> = {
  downtown: { corp: "PINNACLE CORE", color: "#38bdf8", rgb: [56, 189, 248], stars: 4 },
  residential: { corp: "ARCHIVE HABITAT", color: "#f59e0b", rgb: [245, 158, 11], stars: 2 },
  industrial: { corp: "R.S.T. FOUNDRY", color: "#fb923c", rgb: [251, 146, 60], stars: 3 },
  park: { corp: "DETRITUS BIODOME", color: "#34d399", rgb: [52, 211, 153], stars: 3 },
  campus: { corp: "MERIDIA RELAY", color: "#a78bfa", rgb: [167, 139, 250], stars: 2 },
}

const SECTOR_PALETTE: { color: string; rgb: [number, number, number]; code: string; corp: string }[] = [
  { code: "SEC-01", corp: "PINNACLE TOWER GRID", color: "#38bdf8", rgb: [56, 189, 248] },
  { code: "SEC-02", corp: "SUBURBAN HAB-PODS", color: "#fbbf24", rgb: [251, 191, 36] },
  { code: "SEC-03", corp: "R.S.T. REACTOR WORKS", color: "#f97316", rgb: [249, 115, 22] },
  { code: "SEC-04", corp: "EDEN BIO-ARBOREAL", color: "#34d399", rgb: [52, 211, 153] },
  { code: "SEC-05", corp: "CIVIC HEARTH BLOCK", color: "#fb7185", rgb: [251, 113, 133] },
  { code: "SEC-06", corp: "COMMS UPLINK ARRAY", color: "#a78bfa", rgb: [167, 139, 250] },
  { code: "SEC-07", corp: "OLD ARCHIVE RUINS", color: "#94a3b8", rgb: [148, 163, 184] },
]

interface TileBlueprint {
  terrain: TerrainKind
  districtIndex?: number
  building?: BuildingStyle
  label?: string
  bars?: number
}

export function buildBreachBoard(scenario: Scenario): BreachBoard {
  const size = 8
  // Blueprint for the 8x8 tactical island:
  // gx: 0 (North-West) -> 7 (South-East front-right cliff)
  // gy: 0 (North-East) -> 7 (South-West front-left cliff)
  const bp: TileBlueprint[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ terrain: "grass" as TerrainKind })),
  )

  const set = (gx: number, gy: number, patch: Partial<TileBlueprint>) => {
    if (gx >= 0 && gx < size && gy >= 0 && gy < size) {
      bp[gx]![gy] = { ...bp[gx]![gy]!, ...patch }
    }
  }

  // 1. Coastal waters & waterfalls (corners and edges)
  for (const [gx, gy] of [
    [0, 0], [0, 6], [0, 7],
    [1, 7],
    [6, 0], [7, 0], [7, 1],
    [7, 6], [7, 7],
  ] as const) {
    set(gx, gy, { terrain: "water" })
  }

  // 2. Cracked mountains (high tactical ridges)
  for (const [gx, gy] of [
    [0, 1], [1, 0], [2, 0], [6, 1],
  ] as const) {
    set(gx, gy, { terrain: "mountain" })
  }

  // 3. A.C.I.D. industrial pools near Sector 3
  for (const [gx, gy] of [
    [5, 0], [6, 2], [7, 3],
  ] as const) {
    set(gx, gy, { terrain: "acid" })
  }

  // 4. Dense pixel forests (pine & oak clusters)
  for (const [gx, gy] of [
    [0, 4], [1, 1], [1, 3], [1, 6], [2, 6], [3, 4], [3, 6], [4, 7], [6, 4],
  ] as const) {
    set(gx, gy, { terrain: "forest" })
  }

  // 5. Tactical roads & bridges connecting sectors
  for (const [gx, gy] of [
    [2, 2], [2, 3], [2, 4], [3, 1], [4, 1], [4, 4], [4, 6], [5, 4], [6, 7],
  ] as const) {
    set(gx, gy, { terrain: "road" })
  }

  // 6. Place the 7 Corporate Sectors (Districts 0..6)
  // Sector 1 (index 0): Monorepo Heights — Central Pinnacle High-Rise Core
  set(3, 2, { terrain: "plaza", districtIndex: 0, building: "hq-spire", label: "HQ-A", bars: 3 })
  set(3, 3, { terrain: "plaza", districtIndex: 0, building: "sky-twin", label: "TWR-B", bars: 2 })
  set(4, 2, { terrain: "plaza", districtIndex: 0, building: "data-tower", label: "NET-C", bars: 2 })
  set(4, 3, { terrain: "plaza", districtIndex: 0, bars: 0 }) // Mech defense plaza

  // Sector 2 (index 1): Side Project Suburbs — West Habitat Ridge
  set(1, 4, { terrain: "grass", districtIndex: 1, building: "suburb-cottages", label: "HAB-1", bars: 1 })
  set(1, 5, { terrain: "grass", districtIndex: 1, building: "suburb-studio", label: "LAB-2", bars: 1 })
  set(2, 5, { terrain: "road", districtIndex: 1, bars: 0 })

  // Sector 3 (index 2): Legacy Industrial Park — East Heavy Foundry
  set(5, 2, { terrain: "industrial", districtIndex: 2, building: "foundry-stacks", label: "DB-01", bars: 2 })
  set(5, 3, { terrain: "industrial", districtIndex: 2, building: "reactor-dome", label: "CORE", bars: 2 })
  set(6, 3, { terrain: "industrial", districtIndex: 2, bars: 0 })

  // Sector 4 (index 3): Idea Gardens — South-West Botanical Biodomes
  set(2, 7, { terrain: "grass", districtIndex: 3, building: "biodome", label: "BIO-1", bars: 1 })
  set(3, 7, { terrain: "grass", districtIndex: 3, building: "botanical- conservatory", label: "SEED", bars: 1 })
  set(3, 5, { terrain: "forest", districtIndex: 3, bars: 0 })

  // Sector 5 (index 4): Household Quarter — South-Center Civic Hearth
  set(4, 5, { terrain: "plaza", districtIndex: 4, building: "apartments", label: "REG-1", bars: 2 })
  set(5, 5, { terrain: "plaza", districtIndex: 4, building: "hearth-block", label: "HOME", bars: 2 })
  set(5, 6, { terrain: "road", districtIndex: 4, bars: 0 })

  // Sector 6 (index 5): Social Campus — South-East Relay Campus
  set(6, 5, { terrain: "plaza", districtIndex: 5, building: "comms-dish", label: "COMM", bars: 2 })
  set(6, 6, { terrain: "plaza", districtIndex: 5, building: "campus-hall", label: "HALL", bars: 1 })

  // Sector 7 (index 6): Old Docs Quarter — North-West Overgrown Archive Ruins
  set(0, 2, { terrain: "ruin", districtIndex: 6, building: "ruin-archive", label: "DOC-1", bars: 1 })
  set(0, 3, { terrain: "ruin", districtIndex: 6, building: "ruin-monolith", label: "OLD", bars: 1 })
  set(1, 2, { terrain: "ruin", districtIndex: 6, bars: 0 })

  const cols = "ABCDEFGH"
  const grid: BoardTile[][] = Array.from({ length: size }, () => [])
  const tiles: BoardTile[] = []

  for (let gx = 0; gx < size; gx++) {
    for (let gy = 0; gy < size; gy++) {
      const cell = bp[gx]![gy]!
      const dIdx = cell.districtIndex ?? null
      const dist = dIdx !== null ? scenario.districts[dIdx] : undefined
      const theme = dist ? SECTOR_THEMES[dist.kind] : undefined
      const elevation =
        cell.terrain === "water" || cell.terrain === "acid"
          ? -3
          : cell.terrain === "plaza" || cell.terrain === "industrial"
            ? 1
            : 0
      const defenseStars =
        cell.building
          ? (theme?.stars ?? 2)
          : cell.terrain === "mountain"
            ? 4
            : cell.terrain === "forest" || cell.terrain === "ruin"
              ? 2
              : 1
      const tile: BoardTile = {
        gx,
        gy,
        terrain: cell.terrain,
        elevation,
        districtIndex: dIdx,
        building: cell.building ?? null,
        buildingLabel: cell.label,
        powerBars: cell.bars ?? 0,
        defenseStars,
        coordLabel: `${cols[gx]}${gy + 1}`,
      }
      grid[gx]![gy] = tile
      tiles.push(tile)
    }
  }

  // 7. Station Friendly Squad Mechs
  const mechs: MechUnit[] = [
    {
      id: "mech-prime",
      name: "PRIME TITAN",
      pilot: "RALPH KARLSSON",
      kind: "prime",
      gx: 4,
      gy: 3,
      hp: 4,
      maxHp: 4,
      move: 4,
      weapon: "TITAN FIST",
      districtIndex: 0,
    },
    {
      id: "mech-siege",
      name: "ARTILLERY MECH",
      pilot: "CAMILA VERA",
      kind: "siege",
      gx: 6,
      gy: 3,
      hp: 3,
      maxHp: 3,
      move: 3,
      weapon: "ARTILLERY MORTAR",
      districtIndex: 2,
    },
    {
      id: "mech-science",
      name: "PULSE MECH",
      pilot: "BETHANY JONES",
      kind: "science",
      gx: 3,
      gy: 5,
      hp: 3,
      maxHp: 3,
      move: 4,
      weapon: "REPULSOR SHIELD",
      districtIndex: 3,
    },
    {
      id: "mech-tank",
      name: "AEGIS CANNON",
      pilot: "ABE ISAMU",
      kind: "tank",
      gx: 2,
      gy: 5,
      hp: 3,
      maxHp: 3,
      move: 4,
      weapon: "TAURUS CANNON",
      districtIndex: 1,
    },
    {
      id: "mech-jet",
      name: "AERIAL JET",
      pilot: "HENRY KWAN",
      kind: "jet",
      gx: 5,
      gy: 6,
      hp: 3,
      maxHp: 3,
      move: 5,
      weapon: "GEMINI MISSILES",
      districtIndex: 4,
    },
  ]

  // 8. Spawn Vek Kaiju Threats for every urgent item across all districts
  // Hand-tuned tactical positions around each sector so arrows read cleanly without crossing!
  const PRESET_ATTACKS: Record<
    number,
    Array<{ fromGx: number; fromGy: number; targetGx: number; targetGy: number; kind: VekKind; name: string; hp: number }>
  > = {
    0: [
      { fromGx: 2, fromGy: 2, targetGx: 3, targetGy: 2, kind: "alpha-hornet", name: "ALPHA HORNET", hp: 4 },
      { fromGx: 3, fromGy: 4, targetGx: 3, targetGy: 3, kind: "firebug", name: "ALPHA FIREBUG", hp: 4 },
      { fromGx: 4, fromGy: 1, targetGx: 4, targetGy: 2, kind: "scarab", name: "SIEGE SCARAB", hp: 3 },
    ],
    1: [
      { fromGx: 0, fromGy: 4, targetGx: 1, targetGy: 4, kind: "beetle", name: "CHARGER BEETLE", hp: 3 },
    ],
    2: [
      { fromGx: 5, fromGy: 1, targetGx: 5, targetGy: 2, kind: "crab", name: "MAGMA CRAB", hp: 5 },
      { fromGx: 5, fromGy: 4, targetGx: 5, targetGy: 3, kind: "scorpion", name: "ACID SCORPION", hp: 3 },
    ],
    3: [
      { fromGx: 1, fromGy: 7, targetGx: 2, targetGy: 7, kind: "psion", name: "SPORE PSION", hp: 2 },
    ],
    4: [
      { fromGx: 4, fromGy: 4, targetGx: 4, targetGy: 5, kind: "beetle", name: "BURROW BEETLE", hp: 4 },
      { fromGx: 5, fromGy: 7, targetGx: 5, targetGy: 5, kind: "scorpion", name: "LEAPER VEK", hp: 3 },
    ],
    5: [
      { fromGx: 7, fromGy: 5, targetGx: 6, targetGy: 5, kind: "psion", name: "BLAST PSION", hp: 3 },
    ],
    6: [
      { fromGx: 0, fromGy: 5, targetGx: 0, targetGy: 3, kind: "scarab", name: "SPITTER VEK", hp: 3 },
    ],
  }

  const threats: VekThreat[] = []
  scenario.districts.forEach((district, dIdx) => {
    const presets = PRESET_ATTACKS[dIdx] ?? []
    let pCursor = 0
    district.items.forEach((item, itemIdx) => {
      if (!item.urgent && pCursor >= district.urgent) return
      if (!item.urgent) return
      const preset = presets[pCursor % Math.max(1, presets.length)]
      if (!preset) return
      pCursor++
      threats.push({
        id: `vek-${dIdx}-${itemIdx}`,
        name: preset.name,
        kind: preset.kind,
        fromGx: preset.fromGx,
        fromGy: preset.fromGy,
        targetGx: preset.targetGx,
        targetGy: preset.targetGy,
        districtIndex: dIdx,
        itemIndex: itemIdx,
        title: item.title,
        when: item.when ?? "SOON",
        gridDamage: item.when === "Today" ? 2 : 1,
        hp: preset.hp,
      })
    })
  })

  // 9. Assemble SectorInfo summaries
  const sectors: SectorInfo[] = scenario.districts.map((district, idx) => {
    const pal = SECTOR_PALETTE[idx % SECTOR_PALETTE.length]!
    const theme = SECTOR_THEMES[district.kind]
    const sectorTiles = tiles.filter((t) => t.districtIndex === idx)
    const cx = sectorTiles.reduce((s, t) => s + t.gx, 0) / Math.max(1, sectorTiles.length)
    const cy = sectorTiles.reduce((s, t) => s + t.gy, 0) / Math.max(1, sectorTiles.length)
    const sectorThreats = threats.filter((th) => th.districtIndex === idx)
    const sectorMechs = mechs.filter((m) => m.districtIndex === idx)
    const powerGridMw = Math.round(district.weight * 120 + district.activity * 450)

    return {
      index: idx,
      district,
      code: pal.code,
      corpName: pal.corp,
      color: pal.color,
      accentRgb: pal.rgb,
      tiles: sectorTiles,
      centerGx: cx,
      centerGy: cy,
      powerGridMw,
      defenseStars: theme.stars,
      threats: sectorThreats,
      mechs: sectorMechs,
    }
  })

  return {
    scenario,
    size,
    tiles,
    grid,
    sectors,
    mechs,
    threats,
    gridPowerPercent: 84,
    gridBlocksFilled: 6,
    gridBlocksTotal: 7,
    shieldResistPercent: 18,
  }
}
