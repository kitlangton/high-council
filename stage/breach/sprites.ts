import type {
  BoardTile,
  BreachBoard,
  MechKind,
  MechUnit,
  TerrainKind,
  VekKind,
  VekThreat,
} from "./board"

export const TILE_HW = 22 // half-width of isometric tile diamond in art pixels (width = 44)
export const TILE_HH = 11 // half-height of isometric tile diamond in art pixels (height = 22, exact 2:1 slope)
export const CLIFF_DEPTH = 40 // cutaway earth/rock depth on front edges

export type PaletteMode = "day" | "night"

export function packRgba(r: number, g: number, b: number, a = 255): number {
  return ((a & 0xff) << 24) | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff)
}

export function hexToPacked(hex: string, a = 255): number {
  const s = hex.replace("#", "")
  const n = parseInt(s, 16)
  return packRgba((n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, a)
}

export function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace("#", "")
  const n = parseInt(s, 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

// ── 4x5 Ultra-Crisp Pixel Bitmap Font for In-World Tactical Badges ──────────────
const MINI_FONT: Record<string, readonly number[]> = {
  A: [0b0110, 0b1001, 0b1111, 0b1001, 0b1001],
  B: [0b1110, 0b1001, 0b1110, 0b1001, 0b1110],
  C: [0b0111, 0b1000, 0b1000, 0b1000, 0b0111],
  D: [0b1110, 0b1001, 0b1001, 0b1001, 0b1110],
  E: [0b1111, 0b1000, 0b1110, 0b1000, 0b1111],
  F: [0b1111, 0b1000, 0b1110, 0b1000, 0b1000],
  G: [0b0111, 0b1000, 0b1011, 0b1001, 0b0111],
  H: [0b1001, 0b1001, 0b1111, 0b1001, 0b1001],
  I: [0b1110, 0b0100, 0b0100, 0b0100, 0b1110],
  J: [0b0011, 0b0001, 0b0001, 0b1001, 0b0110],
  K: [0b1001, 0b1010, 0b1100, 0b1010, 0b1001],
  L: [0b1000, 0b1000, 0b1000, 0b1000, 0b1111],
  M: [0b1001, 0b1111, 0b1111, 0b1001, 0b1001],
  N: [0b1001, 0b1101, 0b1011, 0b1001, 0b1001],
  O: [0b0110, 0b1001, 0b1001, 0b1001, 0b0110],
  P: [0b1110, 0b1001, 0b1110, 0b1000, 0b1000],
  Q: [0b0110, 0b1001, 0b1001, 0b0110, 0b0011],
  R: [0b1110, 0b1001, 0b1110, 0b1010, 0b1001],
  S: [0b0111, 0b1000, 0b0110, 0b0001, 0b1110],
  T: [0b1110, 0b0100, 0b0100, 0b0100, 0b0100],
  U: [0b1001, 0b1001, 0b1001, 0b1001, 0b0110],
  V: [0b1001, 0b1001, 0b1001, 0b0110, 0b0110],
  W: [0b1001, 0b1001, 0b1111, 0b1111, 0b1001],
  X: [0b1001, 0b0110, 0b0110, 0b0110, 0b1001],
  Y: [0b1001, 0b1001, 0b0110, 0b0100, 0b0100],
  Z: [0b1111, 0b0010, 0b0100, 0b1000, 0b1111],
  "0": [0b0110, 0b1001, 0b1001, 0b1001, 0b0110],
  "1": [0b0100, 0b1100, 0b0100, 0b0100, 0b1110],
  "2": [0b1110, 0b0001, 0b0110, 0b1000, 0b1111],
  "3": [0b1110, 0b0001, 0b0110, 0b0001, 0b1110],
  "4": [0b1001, 0b1001, 0b1111, 0b0001, 0b0001],
  "5": [0b1111, 0b1000, 0b1110, 0b0001, 0b1110],
  "6": [0b0111, 0b1000, 0b1110, 0b1001, 0b0110],
  "7": [0b1111, 0b0001, 0b0010, 0b0100, 0b0100],
  "8": [0b0110, 0b1001, 0b0110, 0b1001, 0b0110],
  "9": [0b0110, 0b1001, 0b0111, 0b0001, 0b1110],
  "-": [0b0000, 0b0000, 0b1110, 0b0000, 0b0000],
  "+": [0b0000, 0b0100, 0b1110, 0b0100, 0b0000],
  "!": [0b0100, 0b0100, 0b0100, 0b0000, 0b0100],
  ":": [0b0000, 0b0100, 0b0000, 0b0100, 0b0000],
  ".": [0b0000, 0b0000, 0b0000, 0b0000, 0b0100],
  "/": [0b0001, 0b0010, 0b0100, 0b1000, 0b0000],
  "%": [0b1001, 0b0010, 0b0100, 0b1001, 0b0000],
}

export class PixelSurface {
  readonly width: number
  readonly height: number
  readonly u32: Uint32Array
  readonly u8: Uint8Array

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    const buf = new ArrayBuffer(width * height * 4)
    this.u32 = new Uint32Array(buf)
    this.u8 = new Uint8Array(buf)
  }

  clear(packedColor: number) {
    this.u32.fill(packedColor)
  }

  pset(x: number, y: number, packedColor: number) {
    const ix = x | 0
    const iy = y | 0
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) return
    this.u32[iy * this.width + ix] = packedColor
  }

  blend(x: number, y: number, r: number, g: number, b: number, a: number) {
    const ix = x | 0
    const iy = y | 0
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height || a <= 0) return
    const idx = (iy * this.width + ix) * 4
    if (a >= 255 || this.u8[idx + 3] === 0) {
      this.u8[idx] = r
      this.u8[idx + 1] = g
      this.u8[idx + 2] = b
      this.u8[idx + 3] = a
      return
    }
    const inv = 255 - a
    this.u8[idx] = (r * a + this.u8[idx]! * inv) >> 8
    this.u8[idx + 1] = (g * a + this.u8[idx + 1]! * inv) >> 8
    this.u8[idx + 2] = (b * a + this.u8[idx + 2]! * inv) >> 8
    this.u8[idx + 3] = Math.min(255, this.u8[idx + 3]! + a)
  }

  rect(x: number, y: number, w: number, h: number, packedColor: number) {
    const x0 = Math.max(0, x | 0)
    const y0 = Math.max(0, y | 0)
    const x1 = Math.min(this.width, (x + w) | 0)
    const y1 = Math.min(this.height, (y + h) | 0)
    for (let py = y0; py < y1; py++) {
      const row = py * this.width
      for (let px = x0; px < x1; px++) {
        this.u32[row + px] = packedColor
      }
    }
  }

  blendRect(x: number, y: number, w: number, h: number, r: number, g: number, b: number, a: number) {
    const x0 = Math.max(0, x | 0)
    const y0 = Math.max(0, y | 0)
    const x1 = Math.min(this.width, (x + w) | 0)
    const y1 = Math.min(this.height, (y + h) | 0)
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        this.blend(px, py, r, g, b, a)
      }
    }
  }

  frame(x: number, y: number, w: number, h: number, packedColor: number) {
    this.rect(x, y, w, 1, packedColor)
    this.rect(x, y + h - 1, w, 1, packedColor)
    this.rect(x, y, 1, h, packedColor)
    this.rect(x + w - 1, y, 1, h, packedColor)
  }

  line(x0: number, y0: number, x1: number, y1: number, packedColor: number) {
    let ix0 = x0 | 0
    let iy0 = y0 | 0
    const ix1 = x1 | 0
    const iy1 = y1 | 0
    const dx = Math.abs(ix1 - ix0)
    const sx = ix0 < ix1 ? 1 : -1
    const dy = -Math.abs(iy1 - iy0)
    const sy = iy0 < iy1 ? 1 : -1
    let err = dx + dy
    while (true) {
      this.pset(ix0, iy0, packedColor)
      if (ix0 === ix1 && iy0 === iy1) break
      const e2 = 2 * err
      if (e2 >= dy) {
        err += dy
        ix0 += sx
      }
      if (e2 <= dx) {
        err += dx
        iy0 += sy
      }
    }
  }

  drawMiniText(x: number, y: number, text: string, fg: number, shadow?: number) {
    let cx = x | 0
    const cy = y | 0
    const up = text.toUpperCase()
    for (let i = 0; i < up.length; i++) {
      const ch = up[i]!
      if (ch === " ") {
        cx += 3
        continue
      }
      const glyph = MINI_FONT[ch]
      if (!glyph) {
        cx += 4
        continue
      }
      for (let ry = 0; ry < 5; ry++) {
        const bits = glyph[ry]!
        for (let rx = 0; rx < 4; rx++) {
          if ((bits >> (3 - rx)) & 1) {
            if (shadow !== undefined) this.pset(cx + rx + 1, cy + ry + 1, shadow)
            this.pset(cx + rx, cy + ry, fg)
          }
        }
      }
      cx += 5
    }
  }

  drawSprite(
    cx: number,
    bottomY: number,
    rows: readonly string[],
    palette: Record<string, number>,
    outlineColor?: number,
    flipX = false,
  ) {
    const h = rows.length
    const w = rows[0]?.length ?? 0
    const x0 = Math.round(cx - w / 2)
    const y0 = Math.round(bottomY - h)

    if (outlineColor !== undefined) {
      for (let ry = 0; ry < h; ry++) {
        const row = rows[ry]!
        for (let rx = 0; rx < w; rx++) {
          const ch = row[flipX ? w - 1 - rx : rx]!
          if (ch === "." || ch === " " || palette[ch] === undefined) continue
          this.pset(x0 + rx - 1, y0 + ry, outlineColor)
          this.pset(x0 + rx + 1, y0 + ry, outlineColor)
          this.pset(x0 + rx, y0 + ry - 1, outlineColor)
          this.pset(x0 + rx, y0 + ry + 1, outlineColor)
        }
      }
    }

    for (let ry = 0; ry < h; ry++) {
      const row = rows[ry]!
      for (let rx = 0; rx < w; rx++) {
        const ch = row[flipX ? w - 1 - rx : rx]!
        if (ch === "." || ch === " ") continue
        const col = palette[ch]
        if (col !== undefined) {
          this.pset(x0 + rx, y0 + ry, col)
        }
      }
    }
  }
}

// ── Isometric Projection Helpers ─────────────────────────────────────────────────
export function tileToIso(gx: number, gy: number, elevation: number, originX: number, originY: number): [number, number] {
  const ix = Math.round(originX + (gx - gy) * TILE_HW)
  const iy = Math.round(originY + (gx + gy) * TILE_HH - elevation)
  return [ix, iy]
}

export function isoToTile(
  artX: number,
  artY: number,
  originX: number,
  originY: number,
  board: BreachBoard,
): { gx: number; gy: number } | null {
  for (let sum = 14; sum >= 0; sum--) {
    for (let gx = 0; gx < 8; gx++) {
      const gy = sum - gx
      if (gy < 0 || gy >= 8) continue
      const tile = board.grid[gx]![gy]!
      const [cx, cy] = tileToIso(gx, gy, tile.elevation, originX, originY)
      const dx = Math.abs(artX - cx)
      const dy = Math.abs(artY - cy)
      if (dx / TILE_HW + dy / TILE_HH <= 1.02) {
        return { gx, gy }
      }
    }
  }
  return null
}

function fillIsoDiamond(
  surf: PixelSurface,
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  colorAt: (dx: number, dy: number, isBorder: boolean, isNorthEdge: boolean, isSouthEdge: boolean) => number,
) {
  for (let dy = -hh; dy <= hh; dy++) {
    const span = (hh - Math.abs(dy)) * 2
    for (let dx = -span; dx < span; dx++) {
      const isBorder = dx <= -span + 1 || dx >= span - 2 || Math.abs(dy) === hh
      const isNorthEdge = dy < 0 && (dx <= -span + 1 || dx >= span - 2)
      const isSouthEdge = dy >= 0 && (dx <= -span + 1 || dx >= span - 2)
      surf.pset(cx + dx, cy + dy, colorAt(dx, dy, isBorder, isNorthEdge, isSouthEdge))
    }
  }
}

function drawIsoBox(
  surf: PixelSurface,
  cx: number,
  cy: number,
  bw: number,
  bh: number,
  height: number,
  topCol: number,
  leftCol: number,
  rightCol: number,
  outlineCol: number,
  windowFn?: (side: "left" | "right", u: number, v: number) => number | null,
) {
  const topCy = cy - height
  // Left face: West corner (dx = -bw, y = cy) down to South corner (dx = 0, y = cy + bh)
  for (let dx = -bw; dx < 0; dx++) {
    const u = dx + bw
    const slopeY = cy + Math.floor((u * bh) / bw)
    for (let y = slopeY - height; y <= slopeY; y++) {
      const v = y - (slopeY - height)
      const isEdge = dx === -bw || dx === -1 || y === slopeY - height || y === slopeY
      let c = isEdge ? outlineCol : leftCol
      if (!isEdge && windowFn) {
        const wCol = windowFn("left", u, v)
        if (wCol !== null) c = wCol
      }
      surf.pset(cx + dx, y, c)
    }
  }
  // Right face: South corner (dx = 0, y = cy + bh) up to East corner (dx = bw, y = cy)
  for (let dx = 0; dx < bw; dx++) {
    const u = dx
    const slopeY = cy + bh - Math.floor((u * bh) / bw)
    for (let y = slopeY - height; y <= slopeY; y++) {
      const v = y - (slopeY - height)
      const isEdge = dx === 0 || dx === bw - 1 || y === slopeY - height || y === slopeY
      let c = isEdge ? outlineCol : rightCol
      if (!isEdge && windowFn) {
        const wCol = windowFn("right", u, v)
        if (wCol !== null) c = wCol
      }
      surf.pset(cx + dx, y, c)
    }
  }
  fillIsoDiamond(surf, cx, topCy, bw, bh, (_dx, _dy, isBorder) => (isBorder ? outlineCol : topCol))
}

// ── Detailed 16-bit Pixel Art Sprites for Mechs & Vek Kaiju ─────────────────────
const MECH_PALETTES: Record<MechKind, Record<string, number>> = {
  prime: {
    W: hexToPacked("#f8fafc"),
    S: hexToPacked("#94a3b8"),
    B: hexToPacked("#2563eb"),
    D: hexToPacked("#1e3a8a"),
    C: hexToPacked("#38bdf8"),
    Y: hexToPacked("#facc15"),
    O: hexToPacked("#f97316"),
    G: hexToPacked("#334155"),
  },
  siege: {
    W: hexToPacked("#fef08a"),
    S: hexToPacked("#ca8a04"),
    B: hexToPacked("#65a30d"),
    D: hexToPacked("#365314"),
    C: hexToPacked("#38bdf8"),
    Y: hexToPacked("#f97316"),
    O: hexToPacked("#ef4444"),
    G: hexToPacked("#334155"),
  },
  science: {
    W: hexToPacked("#f1f5f9"),
    S: hexToPacked("#64748b"),
    B: hexToPacked("#0d9488"),
    D: hexToPacked("#115e59"),
    C: hexToPacked("#2dd4bf"),
    Y: hexToPacked("#a3e635"),
    O: hexToPacked("#38bdf8"),
    G: hexToPacked("#1e293b"),
  },
  tank: {
    W: hexToPacked("#e2e8f0"),
    S: hexToPacked("#64748b"),
    B: hexToPacked("#3b82f6"),
    D: hexToPacked("#1d4ed8"),
    C: hexToPacked("#60a5fa"),
    Y: hexToPacked("#facc15"),
    O: hexToPacked("#f97316"),
    G: hexToPacked("#1e293b"),
  },
  jet: {
    W: hexToPacked("#f8fafc"),
    S: hexToPacked("#94a3b8"),
    B: hexToPacked("#ef4444"),
    D: hexToPacked("#991b1b"),
    C: hexToPacked("#38bdf8"),
    Y: hexToPacked("#facc15"),
    O: hexToPacked("#fb923c"),
    G: hexToPacked("#334155"),
  },
}

const MECH_SPRITES: Record<MechKind, readonly string[]> = {
  prime: [
    ".....YYYYYY.....",
    "....WWWWWWWW....",
    "...WWCCCCCCWW...",
    "..BBBBWWWWBBBB..",
    ".BBWWBBBBBBWWBB.",
    "BBWWBBBOOBBBWWBB",
    "BBWBBBBBBBBBBWBB",
    ".GGGDDDDDDDDGGG.",
    "..GGDDDDDDDDGG..",
    "...BBB....BBB...",
    "...BBB....BBB...",
    "..GGGG....GGGG..",
  ],
  siege: [
    "......GGGGGG....",
    ".....GGGGGGGG...",
    "....WWGGGGGGG...",
    "...BBBBYYYYBBBB.",
    "..BBBBCCCCCCBBBB",
    "..DDDDDDDDDDDDDD",
    ".GGG..DDDDDD..GG",
    "GGG...GG..GG..GG",
    "GG....GG..GG...G",
  ],
  science: [
    ".....CCCCCC.....",
    "...CCWWWWWWCC...",
    "..CWWYYYYYYWWC..",
    "..BBBBBBBBBBBB..",
    "...DDDDDDDDDD...",
    "....GGGGGGGG....",
    "..CCCCCCCCCCCC..",
    "....CCC..CCC....",
  ],
  tank: [
    ".....WWWWWGGGGGG",
    "....WWWCCCCWWW..",
    "...BBBBBBBBBBBB.",
    "..BBBBYYYYYYBBBB",
    ".DDDDDDDDDDDDDDD",
    "GGGGGGGGGGGGGGGG",
    ".GGGGGGGGGGGGGG.",
  ],
  jet: [
    ".......WW.......",
    "......WWWW......",
    "....WWWCCWWW....",
    "..BBBBWWWWBBBB..",
    "BBBBBBBBBBBBBBBB",
    "DDD.DDDDDDDD.DDD",
    ".....YYOOYY.....",
  ],
}

const VEK_PALETTE: Record<string, number> = {
  P: hexToPacked("#a855f7"), // chitin purple
  D: hexToPacked("#581c87"), // dark shell
  R: hexToPacked("#ef4444"), // crimson eyes / stinger
  O: hexToPacked("#f97316"), // orange glow
  Y: hexToPacked("#facc15"), // acid / amber highlight
  G: hexToPacked("#22c55e"), // emerald venom
  W: hexToPacked("#e2e8f0"), // wings / fangs
  K: hexToPacked("#1e1b4b"), // deep legs
}

const VEK_SPRITES: Record<VekKind, readonly string[]> = {
  "alpha-hornet": [
    ".WWW........WWW.",
    "WWWWW..OO..WWWWW",
    ".WWW.PPPPPP.WWW.",
    "....PRRRRRRP....",
    "...PPPPPPPPPP...",
    "....DDDDDDDD....",
    ".....DDRRDD.....",
    "......RRRR......",
  ],
  firebug: [
    "....OO....OO....",
    "...OOO.PP.OOO...",
    "..OOOPRRRRPOOO..",
    "..PPPPYYYYPPPP..",
    ".PPPPPPPPPPPPPP.",
    ".DDDDDDDDDDDDDD.",
    "..K..K....K..K..",
  ],
  scarab: [
    ".....YYYYYY.....",
    "...PPRRRRRRPP...",
    "..PPPPOOOOPPPP..",
    ".PPPPPPPPPPPPPP.",
    ".DDDDDDDDDDDDDD.",
    ".KKK..DDDD..KKK.",
    "KK..K......K..KK",
  ],
  crab: [
    ".RRR........RRR.",
    "RRROO..PP..OORRR",
    "RRROPRRRRRRPORRR",
    "...PPPPPPPPPP...",
    "..DDDDDDDDDDDD..",
    ".KKK.DDDDDD.KKK.",
    "KK..K......K..KK",
  ],
  beetle: [
    "......YYYY......",
    ".....YYYYYY.....",
    "...PPRRRRRRPP...",
    "..PPPPPPPPPPPP..",
    ".PPPPDDDDDDPPPP.",
    "..DDDDDDDDDDDD..",
    "..K..K....K..K..",
  ],
  psion: [
    "....GGGGGGGG....",
    "...GGYYYYYYGG...",
    "..GGPRRRRRRPGG..",
    "..GPPPPPPPPPPG..",
    "...DDDDDDDDDD...",
    "...K..K..K..K...",
    "....K......K....",
  ],
  scorpion: [
    "..........RRRR..",
    ".........ROOOR..",
    ".........PPP....",
    "..OO.PPPPPPPP...",
    ".OOPRRRRRPPPP...",
    "...DDDDDDDDDD...",
    "..K..K..K..K....",
  ],
}

export interface BoardRenderState {
  readonly board: BreachBoard
  readonly selectedSector: number | null
  readonly hoveredTile: { gx: number; gy: number } | null
  readonly selectedTile: { gx: number; gy: number } | null
  readonly time: number
  readonly paletteMode: PaletteMode
  readonly originX: number
  readonly originY: number
}

export function renderPixelBoard(surf: PixelSurface, state: BoardRenderState) {
  const { board, selectedSector, hoveredTile, selectedTile, time, paletteMode, originX, originY } = state
  const isNight = paletteMode === "night"
  const outline = hexToPacked("#090d14")

  // Clear to transparent so the shader's seamless chasm background shows around the island
  surf.clear(0)

  // 1. Drifting chasm clouds below the floating island
  drawChasmClouds(surf, time, originX, originY)

  // 2. Render the 8x8 Isometric Board in strict back-to-front painter's order (gx + gy from 0 to 14)
  for (let sum = 0; sum <= 14; sum++) {
    for (let gx = 0; gx < 8; gx++) {
      const gy = sum - gx
      if (gy < 0 || gy >= 8) continue
      const tile = board.grid[gx]![gy]!
      const [cx, cy] = tileToIso(gx, gy, tile.elevation, originX, originY)
      const [baseCx, baseCy] = tileToIso(gx, gy, 0, originX, originY)

      // 2a. If this tile is recessed (water/acid), draw its sunken stone rim first
      if (tile.elevation < 0) {
        drawRecessedRim(surf, cx, cy, -tile.elevation, tile.terrain, outline)
      }

      // 2b. Draw stone/earth side skirt on every non-recessed tile so adjacent water tiles never expose a gap
      if (tile.elevation >= 0) {
        drawSideSkirt(
          surf,
          cx,
          cy,
          tile.elevation + 5,
          hexToPacked("#334155"),
          hexToPacked("#1e293b"),
          outline,
        )
      }

      // 2c. Draw tile top surface
      const isSectorSelected = selectedSector !== null && tile.districtIndex === selectedSector
      const isHovered = hoveredTile?.gx === gx && hoveredTile?.gy === gy
      const isTileSelected = selectedTile?.gx === gx && selectedTile?.gy === gy
      const threatOnTile = board.threats.find((th) => th.targetGx === gx && th.targetGy === gy)

      drawTileTop(
        surf,
        tile,
        cx,
        cy,
        time,
        isNight,
        board,
        isSectorSelected,
        !!threatOnTile,
      )

      // 2d. Cutaway Earth/Rock Cross-Section along the front island edges (gx === 7 or gy === 7)
      // Anchored to baseCy so the island cliff forms one continuous, solid geological trench block!
      if (gx === 7 || gy === 7) {
        drawIslandCliffCutaway(surf, tile, baseCx, baseCy, time, isNight, outline)
      }

      // 2e. Terrain props & Sector Buildings on this tile
      if (tile.terrain === "mountain") {
        drawMountainMassif(surf, cx, cy, gx, gy, isNight, outline)
      } else if (tile.terrain === "forest" && !tile.building) {
        drawForestCluster(surf, cx, cy, gx, gy, isNight, outline)
      }

      if (tile.building) {
        const sector = tile.districtIndex !== null ? board.sectors[tile.districtIndex]! : null
        drawSectorBuilding(
          surf,
          tile,
          cx,
          cy,
          sector?.accentRgb ?? [56, 189, 248],
          time,
          isNight,
          isSectorSelected,
          !!threatOnTile,
          outline,
        )
      }

      // 2f. Tile selection / hover bouncing pixel bracket cursor
      if (isHovered || isTileSelected) {
        drawTileCursor(surf, cx, cy, time, isTileSelected ? hexToPacked("#38bdf8") : hexToPacked("#ffffff"))
      }

      // 2g. Friendly Mech stationed on this tile
      const mech = board.mechs.find((m) => m.gx === gx && m.gy === gy)
      if (mech) {
        drawMechUnit(surf, mech, cx, cy, time, outline)
      }

      // 2h. Vek Kaiju enemy on this tile
      const vek = board.threats.find((v) => v.fromGx === gx && v.fromGy === gy)
      if (vek) {
        drawVekUnit(surf, vek, cx, cy, time, outline)
      }
    }
  }

  // 3. Pass for Telegraphed Attack Arrows & Floating Threat Badges
  for (const threat of board.threats) {
    const fromTile = board.grid[threat.fromGx]![threat.fromGy]!
    const targetTile = board.grid[threat.targetGx]![threat.targetGy]!
    const [fx, fy] = tileToIso(fromTile.gx, fromTile.gy, fromTile.elevation, originX, originY)
    const [tx, ty] = tileToIso(targetTile.gx, targetTile.gy, targetTile.elevation, originX, originY)
    const isFocused = selectedSector === null || selectedSector === threat.districtIndex
    drawAttackTelegraphArrow(surf, fx, fy - 8, tx, ty - 14, threat, time, isFocused)
  }

  // 4. Compact Sector Number Badges above each Sector's Primary Tile (avoiding threat badges)
  for (const sector of board.sectors) {
    const nonThreatenedTile =
      sector.tiles.find(
        (t) => t.building && !board.threats.some((th) => th.targetGx === t.gx && th.targetGy === t.gy),
      ) ?? sector.tiles[0]
    if (!nonThreatenedTile) continue
    const [ax, ay] = tileToIso(
      nonThreatenedTile.gx,
      nonThreatenedTile.gy,
      nonThreatenedTile.elevation,
      originX,
      originY,
    )
    const isSel = selectedSector === sector.index
    const hasUrgent = sector.threats.length > 0
    const isThreatened = board.threats.some(
      (th) => th.targetGx === nonThreatenedTile.gx && th.targetGy === nonThreatenedTile.gy,
    )
    const baseLift = nonThreatenedTile.building === "hq-spire" ? 44 : 26
    const lift = isThreatened ? baseLift + 15 : baseLift
    drawSectorMapBadge(surf, ax, ay - lift, sector.index + 1, sector.accentRgb, isSel, hasUrgent, time)
  }
}

function drawChasmClouds(surf: PixelSurface, time: number, originX: number, originY: number) {
  const clouds = [
    { baseX: originX - 175, baseY: originY + 188, cw: 64, ch: 9, speed: 5 },
    { baseX: originX + 90, baseY: originY + 196, cw: 76, ch: 10, speed: -4 },
    { baseX: originX - 50, baseY: originY + 210, cw: 88, ch: 9, speed: 3 },
  ]
  for (const cl of clouds) {
    const cx = Math.round(cl.baseX + Math.sin(time * 0.35 + cl.baseY) * cl.speed * 3)
    const cy = cl.baseY
    surf.blendRect(cx, cy, cl.cw, cl.ch, 110, 155, 205, 40)
    surf.blendRect(cx + 8, cy - 2, cl.cw - 16, 2, 160, 205, 245, 35)
  }
}

function drawRecessedRim(
  surf: PixelSurface,
  cx: number,
  cy: number,
  depth: number,
  terrain: TerrainKind,
  outline: number,
) {
  const leftRim = terrain === "acid" ? hexToPacked("#365314") : hexToPacked("#334155")
  const rightRim = terrain === "acid" ? hexToPacked("#1a2e05") : hexToPacked("#1e293b")
  for (let dy = -TILE_HH; dy <= 0; dy++) {
    const span = (TILE_HH - Math.abs(dy)) * 2
    const leftX = cx - span
    const rightX = cx + span - 1
    for (let z = 1; z <= depth; z++) {
      surf.pset(leftX, cy + dy - z, z === depth ? outline : leftRim)
      surf.pset(leftX + 1, cy + dy - z, z === depth ? outline : leftRim)
      surf.pset(rightX, cy + dy - z, z === depth ? outline : rightRim)
      surf.pset(rightX - 1, cy + dy - z, z === depth ? outline : rightRim)
    }
  }
}

function drawSideSkirt(
  surf: PixelSurface,
  cx: number,
  cy: number,
  depth: number,
  leftCol: number,
  rightCol: number,
  outline: number,
) {
  for (let dx = -TILE_HW; dx < 0; dx++) {
    const u = dx + TILE_HW
    const yTop = cy + Math.floor((u * TILE_HH) / TILE_HW)
    for (let z = 1; z <= depth; z++) {
      surf.pset(cx + dx, yTop + z, z === depth ? outline : leftCol)
    }
  }
  for (let dx = 0; dx < TILE_HW; dx++) {
    const u = dx
    const yTop = cy + TILE_HH - Math.floor((u * TILE_HH) / TILE_HW)
    for (let z = 1; z <= depth; z++) {
      surf.pset(cx + dx, yTop + z, z === depth ? outline : rightCol)
    }
  }
}

function drawTileTop(
  surf: PixelSurface,
  tile: BoardTile,
  cx: number,
  cy: number,
  time: number,
  isNight: boolean,
  board: BreachBoard,
  isSectorSelected: boolean,
  isThreatTarget: boolean,
) {
  const { gx, gy, terrain, districtIndex } = tile
  const checker = (gx + gy) & 1
  const animPhase = Math.floor(time * 4)

  let baseCol = hexToPacked("#2f6f42")
  let altCol = hexToPacked("#367d4b")
  let edgeLight = hexToPacked("#4ea065")
  let edgeDark = hexToPacked("#1d492a")

  if (terrain === "water") {
    baseCol = hexToPacked(isNight ? "#0c4a6e" : "#0284c7")
    altCol = hexToPacked(isNight ? "#075985" : "#0369a1")
    edgeLight = hexToPacked("#38bdf8")
    edgeDark = hexToPacked("#082f49")
  } else if (terrain === "acid") {
    baseCol = hexToPacked("#4d7c0f")
    altCol = hexToPacked("#65a30d")
    edgeLight = hexToPacked("#a3e635")
    edgeDark = hexToPacked("#365314")
  } else if (terrain === "grass" || terrain === "forest") {
    baseCol = hexToPacked(checker ? "#2f6e41" : "#29633a")
    altCol = hexToPacked("#39824e")
    edgeLight = hexToPacked("#4c9e63")
    edgeDark = hexToPacked("#1b4327")
  } else if (terrain === "mountain") {
    baseCol = hexToPacked("#475569")
    altCol = hexToPacked("#64748b")
    edgeLight = hexToPacked("#94a3b8")
    edgeDark = hexToPacked("#1e293b")
  } else if (terrain === "road") {
    baseCol = hexToPacked("#334155")
    altCol = hexToPacked("#3f4f66")
    edgeLight = hexToPacked("#64748b")
    edgeDark = hexToPacked("#1e293b")
  } else if (terrain === "plaza") {
    baseCol = hexToPacked(checker ? "#475569" : "#3f4d63")
    altCol = hexToPacked("#52627a")
    edgeLight = hexToPacked("#94a3b8")
    edgeDark = hexToPacked("#1e293b")
  } else if (terrain === "industrial") {
    baseCol = hexToPacked(checker ? "#44403c" : "#3b3734")
    altCol = hexToPacked("#57534e")
    edgeLight = hexToPacked("#fb923c")
    edgeDark = hexToPacked("#1c1917")
  } else if (terrain === "ruin") {
    baseCol = hexToPacked("#3f4a3c")
    altCol = hexToPacked("#4b5945")
    edgeLight = hexToPacked("#64748b")
    edgeDark = hexToPacked("#1e2923")
  }

  const sectorAccent =
    districtIndex !== null ? hexToPacked(board.sectors[districtIndex]!.color) : edgeLight
  const darkSeam = hexToPacked("#0f172a")
  const hazardYellow = hexToPacked("#facc15")
  const hazardBlack = hexToPacked("#18181b")
  const threatRed = hexToPacked("#ef4444")

  fillIsoDiamond(surf, cx, cy, TILE_HW, TILE_HH, (dx, dy, isBorder, isNorth, isSouth) => {
    if (isBorder) {
      if (isThreatTarget) return (animPhase & 1) === 0 ? threatRed : hazardYellow
      if (isSectorSelected) return sectorAccent
      if (isNorth) return edgeLight
      if (isSouth) return darkSeam
      return edgeDark
    }

    if (isThreatTarget && (Math.abs(dx) > TILE_HW - 7 || Math.abs(dy) > TILE_HH - 4)) {
      return ((dx + dy + animPhase) & 3) < 2 ? hazardYellow : hazardBlack
    }

    if (districtIndex !== null && (Math.abs(dx) === TILE_HW - 3 || Math.abs(dy) === TILE_HH - 2)) {
      if (isSectorSelected || ((dx + dy) & 1) === 0) return sectorAccent
    }

    if (terrain === "water") {
      if (Math.abs(dx) >= TILE_HW - 5 || Math.abs(dy) >= TILE_HH - 3) {
        if (((dx + dy + animPhase) & 3) === 0) return hexToPacked("#bae6fd")
      }
      if (((dx - dy * 2 + animPhase * 2) & 15) === 0 && (dy & 1) === 0) {
        return hexToPacked("#7dd3fc")
      }
      return ((dx + dy) & 3) === 0 ? altCol : baseCol
    }

    if (terrain === "acid") {
      if (((dx * 3 + dy * 5 + animPhase) & 15) === 0) return hexToPacked("#d9f99d")
      return ((dx + dy) & 2) === 0 ? altCol : baseCol
    }

    if (terrain === "road") {
      if (Math.abs(dx - dy * 2) <= 1 && ((dx + dy) & 3) < 2) return hexToPacked("#facc15")
      return baseCol
    }

    if (terrain === "industrial") {
      if ((dx & 3) === 0 && (dy & 3) === 0) return hexToPacked("#78716c")
      return baseCol
    }

    if (terrain === "grass" || terrain === "forest") {
      if (((dx * 7 + dy * 13 + gx * 5 + gy * 3) & 31) === 0) return edgeLight
      if (((dx + dy) & 3) === 0) return altCol
    }

    return baseCol
  })
}

function drawIslandCliffCutaway(
  surf: PixelSurface,
  tile: BoardTile,
  cx: number,
  cy: number,
  time: number,
  isNight: boolean,
  outline: number,
) {
  const { gx, gy, terrain } = tile
  const isWater = terrain === "water"
  const isAcid = terrain === "acid"
  const anim = Math.floor(time * 8)

  const drawCliffColumn = (
    px: number,
    yTop: number,
    side: "left" | "right",
    u: number,
    isOuterLeftCorner: boolean,
    isOuterRightCorner: boolean,
    isCenterApex: boolean,
  ) => {
    const shade = side === "left" ? 1.0 : 0.75
    const jag = ((u * 5 + gx * 3 + gy * 7) % 5) - 2
    const depth = CLIFF_DEPTH + jag

    for (let z = 1; z <= depth; z++) {
      const py = yTop + z
      if (z === depth || isOuterLeftCorner || isOuterRightCorner || isCenterApex) {
        surf.pset(px, py, outline)
        continue
      }

      // Water/Acid tiles pour a waterfall stream down the middle of their rock cliff!
      if ((isWater || isAcid) && u >= 3 && u <= TILE_HW - 4 && z >= 3) {
        const fallStream = (u * 3 + z - anim) & 7
        if (isAcid) {
          const c =
            fallStream < 2
              ? hexToPacked("#d9f99d")
              : fallStream < 5
                ? hexToPacked("#84cc16")
                : hexToPacked("#3f6212")
          surf.pset(px, py, c)
        } else {
          const c =
            fallStream < 2
              ? hexToPacked("#e0f2fe")
              : fallStream < 5
                ? hexToPacked("#38bdf8")
                : hexToPacked(isNight ? "#0369a1" : "#0284c7")
          surf.pset(px, py, c)
        }
        continue
      }

      // Continuous layered geological cross-section:
      // z 1..3: Overhanging turf/pavement lip
      // z 4..11: Rich brown topsoil + pebbles + roots
      // z 12..27: Stratified slate & limestone + embedded copper/steel pipes
      // z 28..depth: Deep basalt crags
      let r = 51, g = 65, b = 85
      if (z <= 3) {
        r = terrain === "industrial" ? 120 : 58
        g = terrain === "industrial" ? 83 : 118
        b = terrain === "industrial" ? 45 : 68
      } else if (z <= 11) {
        const pebble = ((u + z * 3 + gx * 7) & 7) === 0
        r = pebble ? 128 : 106
        g = pebble ? 85 : 68
        b = pebble ? 54 : 43
      } else if (z <= 27) {
        const hasPipe = (gx === 5 || gx === 3 || gy === 5) && u >= 8 && u <= 13 && z >= 15 && z <= 20
        if (hasPipe) {
          if (z === 15 || z === 20 || u === 8 || u === 13) {
            r = 25; g = 35; b = 52
          } else if (u >= 10 && u <= 11 && z >= 17) {
            r = 56; g = 189; b = 248
          } else {
            r = 180; g = 83; b = 9
          }
        } else {
          const band = (z >> 2) & 1
          const fault = ((u + z + gx * 3) & 15) === 0
          r = fault ? 30 : band ? 74 : 58
          g = fault ? 41 : band ? 88 : 71
          b = fault ? 59 : band ? 108 : 89
        }
      } else {
        r = 32
        g = 43
        b = 62
      }

      surf.pset(
        px,
        py,
        packRgba(Math.round(r * shade), Math.round(g * shade), Math.round(b * shade)),
      )
    }

    if ((isWater || isAcid) && u >= 3 && u <= TILE_HW - 4 && ((u + anim) & 3) < 2) {
      const mistCol = isAcid ? hexToPacked("#bef264") : hexToPacked("#e0f2fe")
      surf.pset(px, yTop + depth + 1, mistCol)
      if ((u & 1) === 0) surf.pset(px, yTop + depth + 2, mistCol)
    }
  }

  // South-West cliff face (gy === 7): slopes down from West corner (cy) to South corner (cy + TILE_HH)
  if (gy === 7) {
    for (let dx = -TILE_HW; dx < 0; dx++) {
      const u = dx + TILE_HW
      const yTop = cy + Math.floor((u * TILE_HH) / TILE_HW)
      drawCliffColumn(
        cx + dx,
        yTop,
        "left",
        u,
        gx === 0 && u === 0,
        false,
        gx === 7 && dx === -1,
      )
    }
  }

  // South-East cliff face (gx === 7): slopes up from South corner (cy + TILE_HH) to East corner (cy)
  if (gx === 7) {
    for (let dx = 0; dx < TILE_HW; dx++) {
      const u = dx
      const yTop = cy + TILE_HH - Math.floor((u * TILE_HH) / TILE_HW)
      drawCliffColumn(
        cx + dx,
        yTop,
        "right",
        u,
        false,
        gy === 0 && u === TILE_HW - 1,
        gy === 7 && dx === 0,
      )
    }
  }
}

function drawMountainMassif(
  surf: PixelSurface,
  cx: number,
  cy: number,
  gx: number,
  gy: number,
  isNight: boolean,
  outline: number,
) {
  const peakH = 20 + ((gx * 3 + gy * 5) % 4)
  const baseW = 16
  const baseH = 8
  const leftSlate = hexToPacked(isNight ? "#64748b" : "#94a3b8")
  const rightSlate = hexToPacked(isNight ? "#334155" : "#475569")
  const snowLeft = hexToPacked("#f8fafc")
  const snowRight = hexToPacked("#cbd5e1")

  for (let h = 0; h < peakH; h++) {
    const t = h / peakH
    const w = Math.max(2, Math.round(baseW * (1 - t * 0.82)))
    const hh = Math.max(1, Math.round(baseH * (1 - t * 0.82)))
    const py = cy - h
    const isSnow = h > peakH * 0.62
    for (let dx = -w; dx <= w; dx++) {
      const dySpan = Math.round(hh * (1 - Math.abs(dx) / (w + 0.5)))
      for (let dy = -dySpan; dy <= dySpan; dy++) {
        const isEdge = Math.abs(dx) === w || Math.abs(dy) === dySpan || h === peakH - 1
        if (isEdge && (h === peakH - 1 || Math.abs(dx) === w)) {
          surf.pset(cx + dx, py + dy, outline)
        } else if (dx < 0) {
          surf.pset(cx + dx, py + dy, isSnow ? snowLeft : leftSlate)
        } else {
          surf.pset(cx + dx, py + dy, isSnow ? snowRight : rightSlate)
        }
      }
    }
  }
}

function drawForestCluster(
  surf: PixelSurface,
  cx: number,
  cy: number,
  gx: number,
  gy: number,
  _isNight: boolean,
  outline: number,
) {
  const pineRows = [
    "...LL...",
    "..LLLL..",
    ".LLMMLL.",
    "..LLLL..",
    ".LLMMLL.",
    "LLLLMMMM",
    ".MMMMDD.",
    "...TT...",
    "...TT...",
  ]
  const pal = {
    L: hexToPacked("#4ade80"),
    M: hexToPacked("#16a34a"),
    D: hexToPacked("#14532d"),
    T: hexToPacked("#78350f"),
  }
  const offsets: [number, number][] = [
    [-7, -1],
    [6, -2],
    [0, 3],
  ]
  for (const [ox, oy] of offsets) {
    surf.drawSprite(cx + ox + ((gx + gy) & 1), cy + oy, pineRows, pal, outline)
  }
}

function drawSectorBuilding(
  surf: PixelSurface,
  tile: BoardTile,
  cx: number,
  cy: number,
  accentRgb: [number, number, number],
  time: number,
  isNight: boolean,
  isSelected: boolean,
  isThreatened: boolean,
  outline: number,
) {
  const style = tile.building!
  const winWarm = hexToPacked("#fde047")
  const winCyan = hexToPacked("#38bdf8")
  const winOff = hexToPacked("#1e293b")
  const accentCol = packRgba(accentRgb[0], accentRgb[1], accentRgb[2])
  const roofPulse = isThreatened
    ? hexToPacked(Math.floor(time * 6) & 1 ? "#ef4444" : "#facc15")
    : isSelected
      ? accentCol
      : outline

  if (style === "hq-spire") {
    drawIsoBox(
      surf,
      cx,
      cy + 1,
      11,
      5,
      28,
      hexToPacked("#e2e8f0"),
      hexToPacked("#cbd5e1"),
      hexToPacked("#64748b"),
      roofPulse,
      (_side, u, v) => {
        if (v > 3 && v < 25 && v % 4 !== 0 && u >= 2 && u <= 8 && u % 3 !== 0) {
          return (u + v) % 5 === 0 ? winCyan : winWarm
        }
        return null
      },
    )
    drawIsoBox(
      surf,
      cx,
      cy - 27,
      6,
      3,
      7,
      hexToPacked("#38bdf8"),
      hexToPacked("#e2e8f0"),
      hexToPacked("#94a3b8"),
      outline,
    )
    surf.line(cx, cy - 34, cx, cy - 41, outline)
    surf.pset(cx, cy - 42, Math.floor(time * 4) & 1 ? hexToPacked("#ef4444") : winCyan)
  } else if (style === "sky-twin") {
    drawIsoBox(
      surf,
      cx - 4,
      cy,
      6,
      3,
      21,
      hexToPacked("#e2e8f0"),
      hexToPacked("#94a3b8"),
      hexToPacked("#475569"),
      roofPulse,
      (_s, u, v) => (v > 2 && v % 3 !== 0 && u >= 2 && u <= 4 ? winWarm : null),
    )
    drawIsoBox(
      surf,
      cx + 5,
      cy + 2,
      6,
      3,
      17,
      hexToPacked("#e2e8f0"),
      hexToPacked("#94a3b8"),
      hexToPacked("#475569"),
      roofPulse,
      (_s, u, v) => (v > 2 && v % 3 !== 0 && u >= 2 && u <= 4 ? winCyan : null),
    )
  } else if (style === "data-tower") {
    drawIsoBox(
      surf,
      cx,
      cy + 1,
      9,
      4,
      19,
      hexToPacked("#38bdf8"),
      hexToPacked("#64748b"),
      hexToPacked("#334155"),
      roofPulse,
      (_s, u, v) => (v > 2 && v % 3 === 1 && u >= 2 && u <= 6 ? winCyan : null),
    )
  } else if (style === "suburb-cottages" || style === "suburb-studio") {
    const h1 = style === "suburb-cottages" ? 9 : 11
    drawIsoBox(
      surf,
      cx - 4,
      cy + 1,
      6,
      3,
      h1,
      hexToPacked("#ef4444"),
      hexToPacked("#f1f5f9"),
      hexToPacked("#94a3b8"),
      roofPulse,
      (_s, u, v) => (v >= 3 && v <= 6 && u >= 2 && u <= 4 ? winWarm : null),
    )
    drawIsoBox(
      surf,
      cx + 5,
      cy + 2,
      5,
      2,
      8,
      hexToPacked("#f97316"),
      hexToPacked("#e2e8f0"),
      hexToPacked("#64748b"),
      outline,
      (_s, u, v) => (v >= 3 && v <= 5 && u >= 2 && u <= 3 ? winWarm : null),
    )
  } else if (style === "foundry-stacks" || style === "reactor-dome") {
    const isReactor = style === "reactor-dome"
    drawIsoBox(
      surf,
      cx,
      cy + 1,
      11,
      5,
      14,
      hexToPacked(isReactor ? "#f97316" : "#78350f"),
      hexToPacked("#57534e"),
      hexToPacked("#292524"),
      roofPulse,
      (_s, u, v) => (v >= 5 && v <= 10 && u % 3 === 1 ? hexToPacked("#fb923c") : null),
    )
    const sx1 = cx - 3
    const sx2 = cx + 3
    surf.rect(sx1 - 1, cy - 21, 3, 8, hexToPacked("#44403c"))
    surf.rect(sx2 - 1, cy - 19, 3, 6, hexToPacked("#44403c"))
    const puff = Math.floor(time * 3) % 4
    surf.rect(sx1 - 1 + (puff & 1), cy - 24 - puff, 3, 2, hexToPacked("#94a3b8"))
    surf.rect(sx2 + (puff & 1), cy - 22 - puff, 2, 2, hexToPacked("#cbd5e1"))
  } else if (style === "biodome" || style === "botanical- conservatory") {
    drawIsoBox(
      surf,
      cx,
      cy + 1,
      10,
      5,
      7,
      hexToPacked("#10b981"),
      hexToPacked("#a7f3d0"),
      hexToPacked("#059669"),
      roofPulse,
    )
    drawIsoBox(
      surf,
      cx,
      cy - 6,
      7,
      3,
      5,
      hexToPacked("#ecfdf5"),
      hexToPacked("#6ee7b7"),
      hexToPacked("#10b981"),
      outline,
    )
  } else if (style === "apartments" || style === "hearth-block") {
    drawIsoBox(
      surf,
      cx,
      cy + 1,
      10,
      5,
      16,
      hexToPacked("#fb7185"),
      hexToPacked("#fecdd3"),
      hexToPacked("#9f1239"),
      roofPulse,
      (_s, u, v) => (v > 2 && v % 3 !== 0 && u >= 2 && u <= 7 && u % 2 === 0 ? winWarm : null),
    )
  } else if (style === "comms-dish" || style === "campus-hall") {
    drawIsoBox(
      surf,
      cx,
      cy + 1,
      10,
      5,
      13,
      hexToPacked("#a78bfa"),
      hexToPacked("#cbd5e1"),
      hexToPacked("#475569"),
      roofPulse,
      (_s, u, v) => (v > 2 && v % 3 === 1 && u >= 2 && u <= 7 ? winCyan : null),
    )
    if (style === "comms-dish") {
      surf.line(cx, cy - 12, cx, cy - 18, outline)
      surf.rect(cx - 3, cy - 20, 7, 2, hexToPacked("#f8fafc"))
      surf.pset(cx, cy - 22, winCyan)
    }
  } else {
    drawIsoBox(
      surf,
      cx,
      cy + 1,
      9,
      4,
      12,
      hexToPacked("#4ade80"),
      hexToPacked("#64748b"),
      hexToPacked("#334155"),
      roofPulse,
      (_s, u, v) => (v === 5 && u === 4 ? (isNight ? winWarm : winOff) : (u + v) % 4 === 0 ? hexToPacked("#16a34a") : null),
    )
  }

  // Power Grid battery bars snug above building roof
  if (tile.powerBars > 0) {
    const roofH =
      style === "hq-spire"
        ? 36
        : style === "sky-twin"
          ? 23
          : style === "data-tower"
            ? 21
            : style === "foundry-stacks" || style === "reactor-dome"
              ? 22
              : style === "apartments" || style === "hearth-block"
                ? 18
                : style === "comms-dish"
                  ? 21
                  : style === "campus-hall"
                    ? 15
                    : 14
    const bx = Math.round(cx - (tile.powerBars * 4) / 2)
    const by = cy - roofH
    surf.rect(bx - 1, by - 1, tile.powerBars * 4 + 1, 5, outline)
    for (let i = 0; i < tile.powerBars; i++) {
      surf.rect(
        bx + i * 4,
        by,
        3,
        3,
        isThreatened && (Math.floor(time * 6) & 1) ? hexToPacked("#ef4444") : hexToPacked("#facc15"),
      )
    }
  }
}

function drawTileCursor(surf: PixelSurface, cx: number, cy: number, time: number, color: number) {
  const bounce = Math.round(Math.sin(time * 7) * 1.5)
  const y = cy + bounce
  const outline = hexToPacked("#090d14")
  surf.line(cx - 6, y - TILE_HH + 3, cx, y - TILE_HH, color)
  surf.line(cx, y - TILE_HH, cx + 6, y - TILE_HH + 3, color)
  surf.line(cx - 6, y + TILE_HH - 3, cx, y + TILE_HH, color)
  surf.line(cx, y + TILE_HH, cx + 6, y + TILE_HH - 3, color)
  surf.line(cx - TILE_HW, y, cx - TILE_HW + 6, y - 3, color)
  surf.line(cx - TILE_HW, y, cx - TILE_HW + 6, y + 3, color)
  surf.line(cx + TILE_HW - 1, y, cx + TILE_HW - 7, y - 3, color)
  surf.line(cx + TILE_HW - 1, y, cx + TILE_HW - 7, y + 3, color)
  surf.pset(cx, y - TILE_HH - 1, outline)
}

function drawMechUnit(
  surf: PixelSurface,
  mech: MechUnit,
  cx: number,
  cy: number,
  time: number,
  outline: number,
) {
  const bob = Math.floor(time * 2.8 + mech.gx) & 1
  surf.blendRect(cx - 7, cy - 2, 14, 4, 5, 10, 18, 165)

  const rows = MECH_SPRITES[mech.kind]
  const pal = MECH_PALETTES[mech.kind]
  surf.drawSprite(cx, cy + 3 - bob, rows, pal, outline)

  // Floating green Mech HP bar above head
  const hpW = mech.maxHp * 3 + 1
  const hx = Math.round(cx - hpW / 2)
  const hy = cy - rows.length - 3 - bob
  surf.rect(hx, hy, hpW, 4, outline)
  for (let i = 0; i < mech.maxHp; i++) {
    surf.rect(
      hx + 1 + i * 3,
      hy + 1,
      2,
      2,
      i < mech.hp ? hexToPacked("#4ade80") : hexToPacked("#334155"),
    )
  }
}

function drawVekUnit(
  surf: PixelSurface,
  vek: VekThreat,
  cx: number,
  cy: number,
  time: number,
  outline: number,
) {
  const bob = Math.floor(time * 3.6 + vek.fromGx * 2) & 1
  surf.blendRect(cx - 7, cy - 2, 14, 4, 25, 5, 35, 175)

  const rows = VEK_SPRITES[vek.kind]
  surf.drawSprite(cx, cy + 3 - bob, rows, VEK_PALETTE, outline, vek.targetGx < vek.fromGx)

  const hpW = vek.hp * 3 + 1
  const hx = Math.round(cx - hpW / 2)
  const hy = cy - rows.length - 3 - bob
  surf.rect(hx, hy, hpW, 4, outline)
  for (let i = 0; i < vek.hp; i++) {
    surf.rect(hx + 1 + i * 3, hy + 1, 2, 2, hexToPacked("#f43f5e"))
  }
}

function drawAttackTelegraphArrow(
  surf: PixelSurface,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  threat: VekThreat,
  time: number,
  isFocused: boolean,
) {
  const outline = hexToPacked("#090d14")
  const hotRed = hexToPacked(isFocused ? "#ef4444" : "#991b1b")
  const hotAmber = hexToPacked(isFocused ? "#facc15" : "#f97316")
  const hotWhite = hexToPacked("#fef08a")

  const steps = 26
  const arcLift = 18
  const pulseStep = Math.floor(time * 14) % steps

  let prevX = x0
  let prevY = y0
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const ax = Math.round(x0 + (x1 - x0) * t)
    const ay = Math.round(y0 + (y1 - y0) * t - Math.sin(t * Math.PI) * arcLift)

    const isPulse = Math.abs(i - pulseStep) <= 2 || Math.abs(i - ((pulseStep + 13) % steps)) <= 1
    const col = isPulse ? hotWhite : (i & 1) === 0 ? hotAmber : hotRed

    surf.line(prevX, prevY + 1, ax, ay + 1, outline)
    surf.line(prevX, prevY - 1, ax, ay - 1, outline)
    surf.line(prevX, prevY, ax, ay, col)
    prevX = ax
    prevY = ay
  }

  for (let dy = 0; dy < 5; dy++) {
    surf.rect(x1 - dy - 1, y1 - dy, dy * 2 + 3, 1, outline)
    surf.rect(x1 - dy, y1 - dy, dy * 2 + 1, 1, dy < 2 ? hotWhite : hotRed)
  }

  // Crisp "!-1" / "!-2" grid damage warning badge above target
  const bob = Math.floor(time * 5) & 1
  const textStr = `!-${threat.gridDamage}`
  const bw = textStr.length * 5 + 3
  const bh = 9
  const bx = Math.round(x1 - bw / 2)
  const by = y1 - 15 - bob
  surf.rect(bx - 1, by - 1, bw + 2, bh + 2, outline)
  surf.rect(bx, by, bw, bh, hexToPacked("#dc2626"))
  surf.frame(bx, by, bw, bh, hotAmber)
  surf.drawMiniText(bx + 2, by + 2, textStr, hexToPacked("#ffffff"))
}

function drawSectorMapBadge(
  surf: PixelSurface,
  cx: number,
  cy: number,
  num: number,
  accentRgb: [number, number, number],
  isSelected: boolean,
  hasUrgent: boolean,
  time: number,
) {
  const label = `S${num}`
  const w = label.length * 5 + (hasUrgent ? 8 : 3)
  const h = 9
  const x = Math.round(cx - w / 2)
  const y = Math.round(cy - (isSelected ? 2 : 0))
  const outline = hexToPacked("#090d14")
  const accent = packRgba(accentRgb[0], accentRgb[1], accentRgb[2])

  surf.rect(x - 1, y - 1, w + 2, h + 2, outline)
  surf.rect(x, y, w, h, isSelected ? hexToPacked("#1e293b") : hexToPacked("#0f172a"))
  surf.frame(x, y, w, h, isSelected ? hexToPacked("#f8fafc") : accent)
  surf.rect(x + 1, y + 1, 2, h - 2, accent)

  surf.drawMiniText(
    x + 4,
    y + 2,
    label,
    isSelected ? hexToPacked("#ffffff") : hexToPacked("#e2e8f0"),
  )

  if (hasUrgent) {
    const blink = (Math.floor(time * 5) & 1) === 0
    surf.rect(x + w - 6, y + 1, 5, h - 2, blink ? hexToPacked("#ef4444") : hexToPacked("#facc15"))
    surf.drawMiniText(x + w - 5, y + 2, "!", blink ? hexToPacked("#ffffff") : outline)
  }
}
