import { LANDMARK_META, PATH_EDGES, WORLD_H, WORLD_W, type LandmarkNode } from "./landmarks"

// Deterministic hash for pixel dithering, trees, and stars.
function hash2(x: number, y: number): number {
  let n = (x * 374761393 + y * 668265263) ^ 0x5bd1e995
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}

// Signed distance to a rounded box for organic island shapes
function sdBox(px: number, py: number, cx: number, cy: number, rx: number, ry: number, r = 12): number {
  const dx = Math.max(Math.abs(px - cx) - (rx - r), 0)
  const dy = Math.max(Math.abs(py - cy) - (ry - r), 0)
  return Math.hypot(dx, dy) - r
}

// Smooth minimum for blending organic island lobes
function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}

// Evaluate island elevation field at (x, y) in 512x320 world coordinates
function islandField(x: number, y: number): {
  mainDist: number
  reefDist: number
  tier2Dist: number
  tier3Dist: number
  volcanoDist: number
  lagoonDist: number
  riverDist: number
} {
  // Subtle organic coastline wobble
  const n1 =
    Math.sin(x * 0.045 + y * 0.03) * 5.5 +
    Math.cos(x * 0.08 - y * 0.06) * 3.5 +
    Math.sin(x * 0.15 + y * 0.12) * 1.8

  // Main continent lobes
  const northLobe = sdBox(x, y, 248, 104, 140, 46, 36)
  const westLobe = sdBox(x, y, 132, 178, 72, 74, 38)
  const centralLobe = sdBox(x, y, 250, 184, 88, 68, 34)
  const eastLobe = sdBox(x, y, 354, 152, 68, 56, 32)
  const southBayLobe = sdBox(x, y, 330, 234, 56, 40, 26)

  let mainDist = smin(northLobe, westLobe, 28)
  mainDist = smin(mainDist, centralLobe, 28)
  mainDist = smin(mainDist, eastLobe, 24)
  mainDist = smin(mainDist, southBayLobe, 22)
  // Carve a scenic southern bay between Star Sanctuary (west) and Millennial Fair (east)
  const southCove = Math.hypot((x - 224) * 0.9, (y - 270) * 1.15) - 34
  mainDist = Math.max(mainDist, -southCove) + n1 * 0.65

  // Eastern Haunted Reef Island (for Sunken Ghost Ship / Old Docs Quarter)
  const reefDist = sdBox(x, y, 448, 228, 34, 28, 18) + n1 * 0.45

  // Tier 2 plateaus (Northwest Toadstool Hills, Central Highland, Northeast Magma Foothills)
  const nwHill = sdBox(x, y, 112, 124, 46, 26, 16) + n1 * 0.3
  const neVolcanoBase = sdBox(x, y, 380, 120, 42, 28, 16) + n1 * 0.3
  const midHighland = sdBox(x, y, 248, 110, 72, 32, 18) + n1 * 0.25
  const tier2Dist = Math.min(nwHill, neVolcanoBase, midHighland)

  // Tier 3 Northern Summit (Grand Keep / Guardia Citadel)
  const tier3Dist = sdBox(x, y, 248, 84, 52, 24, 14) + n1 * 0.2

  // Volcanic dark rock zone around Magma Foundry
  const volcanoDist = Math.hypot((x - 382) * 0.85, (y - 118) * 1.05) - 38 + n1 * 0.35

  // Crystal Lagoon at Star Sanctuary (Idea Gardens)
  const lagoonDist = Math.hypot((x - 118) * 0.85, (y - 220) * 1.1) - 24 + n1 * 0.2

  // Winding river from northern waterfalls down into the lagoon and eastern strait
  // Branch A: West waterfall (x=202) -> under bridge (186, 124) -> Lagoon (118, 220) -> South sea
  const rWestX = 186 + Math.sin((y - 124) * 0.042) * 12
  const dRiverWest = y >= 100 && y <= 265 ? Math.abs(x - rWestX) - 4.5 : 999
  // Branch B: East waterfall (x=294) -> under bridge (298, 124) -> SE to Eastern Strait
  const rEastY = 122 + (x - 294) * 0.32 + Math.sin((x - 294) * 0.07) * 4
  const dRiverEast = x >= 290 && x <= 415 && y >= 100 && y <= 174 ? Math.abs(y - rEastY) - 4.2 : 999
  // Central creek under vertical bridge (x=248, y=146) connecting west & east rivers
  const rMidY = 146 + Math.sin((x - 186) * 0.05) * 3
  const dRiverMid = x >= 184 && x <= 310 ? Math.abs(y - rMidY) - 3.8 : 999

  const riverDist = Math.min(dRiverWest, dRiverEast, dRiverMid)

  return { mainDist, reefDist, tier2Dist, tier3Dist, volcanoDist, lagoonDist, riverDist }
}

function pxRect(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h))
}

// Draw a 16-bit pine tree (northern & highland forests)
function drawPineTree(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, variant = 0) {
  const ix = Math.round(x)
  const iy = Math.round(y)
  // Shadow
  pxRect(ctx, ix - 5, iy + 1, 10, 3, "rgba(10, 28, 18, 0.45)")
  // Trunk
  pxRect(ctx, ix - 1, iy - 2, 3, 4, "#5c2d16")
  const cDark = variant === 1 ? "#115e59" : "#14532d"
  const cMid = variant === 1 ? "#0d9488" : "#15803d"
  const cLight = variant === 1 ? "#2dd4bf" : "#22c55e"
  // Bottom tier
  pxRect(ctx, ix - 5, iy - 5, 11, 3, cDark)
  pxRect(ctx, ix - 4, iy - 6, 9, 2, cMid)
  pxRect(ctx, ix - 3, iy - 6, 4, 1, cLight)
  // Mid tier
  pxRect(ctx, ix - 4, iy - 8, 9, 3, cDark)
  pxRect(ctx, ix - 3, iy - 9, 7, 2, cMid)
  pxRect(ctx, ix - 2, iy - 9, 3, 1, cLight)
  // Top spire
  pxRect(ctx, ix - 2, iy - 11, 5, 2, cMid)
  pxRect(ctx, ix - 1, iy - 13, 3, 2, cLight)
  pxRect(ctx, ix, iy - 14, 1, 1, "#86efac")
}

// Draw a rounded 16-bit deciduous / illusion tree (SMW Forest of Illusion style)
function drawRoundTree(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  style: "green" | "illusion" | "autumn" | "dead" = "green",
) {
  const ix = Math.round(x)
  const iy = Math.round(y)
  pxRect(ctx, ix - 5, iy + 1, 10, 3, "rgba(10, 28, 18, 0.42)")
  pxRect(ctx, ix - 1, iy - 3, 3, 5, "#6b3410")
  if (style === "dead") {
    pxRect(ctx, ix - 2, iy - 7, 2, 5, "#334155")
    pxRect(ctx, ix - 4, iy - 9, 2, 2, "#64748b")
    pxRect(ctx, ix + 1, iy - 8, 3, 2, "#64748b")
    return
  }
  const pal =
    style === "illusion"
      ? ["#1e3a8a", "#0284c7", "#38bdf8", "#bae6fd"]
      : style === "autumn"
        ? ["#7c2d12", "#c2410c", "#f97316", "#fdba74"]
        : ["#14532d", "#16a34a", "#4ade80", "#bbf7d0"]
  pxRect(ctx, ix - 5, iy - 9, 11, 6, pal[0]!)
  pxRect(ctx, ix - 4, iy - 11, 9, 7, pal[1]!)
  pxRect(ctx, ix - 3, iy - 12, 7, 5, pal[2]!)
  pxRect(ctx, ix - 2, iy - 11, 3, 2, pal[3]!)
  pxRect(ctx, ix + 1, iy - 8, 1, 1, pal[3]!)
}

// Draw a beach palm tree
function drawPalmTree(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number) {
  const ix = Math.round(x)
  const iy = Math.round(y)
  pxRect(ctx, ix - 4, iy + 1, 8, 2, "rgba(15, 35, 25, 0.35)")
  pxRect(ctx, ix - 1, iy - 2, 2, 3, "#78350f")
  pxRect(ctx, ix, iy - 5, 2, 3, "#92400e")
  pxRect(ctx, ix + 1, iy - 8, 2, 3, "#b45309")
  pxRect(ctx, ix - 4, iy - 10, 11, 2, "#15803d")
  pxRect(ctx, ix - 2, iy - 11, 7, 2, "#22c55e")
  pxRect(ctx, ix - 5, iy - 9, 2, 2, "#16a34a")
  pxRect(ctx, ix + 5, iy - 9, 2, 2, "#16a34a")
  pxRect(ctx, ix, iy - 11, 3, 1, "#86efac")
  pxRect(ctx, ix, iy - 8, 2, 1, "#451a03")
}

// Draw a wooden bridge across water/river
function drawBridge(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  vertical = false,
) {
  const ix = Math.round(x - w / 2)
  const iy = Math.round(y - h / 2)
  pxRect(ctx, ix + 1, iy + 2, w, h, "rgba(8, 20, 44, 0.55)")
  if (!vertical) {
    pxRect(ctx, ix, iy, w, h, "#451a03")
    pxRect(ctx, ix, iy + 1, w, h - 2, "#78350f")
    for (let px = ix + 1; px < ix + w - 1; px += 3) {
      pxRect(ctx, px, iy + 2, 2, h - 4, "#b45309")
      pxRect(ctx, px, iy + 2, 2, 2, "#d97706")
    }
    pxRect(ctx, ix, iy, w, 1, "#fcd34d")
    pxRect(ctx, ix, iy + h - 1, w, 1, "#b45309")
    for (let px = ix; px <= ix + w - 2; px += Math.max(4, Math.floor(w / 3))) {
      pxRect(ctx, px, iy - 1, 2, 3, "#5c2d16")
      pxRect(ctx, px, iy - 1, 2, 1, "#fbbf24")
      pxRect(ctx, px, iy + h - 2, 2, 3, "#5c2d16")
    }
  } else {
    pxRect(ctx, ix, iy, w, h, "#451a03")
    pxRect(ctx, ix + 1, iy, w - 2, h, "#78350f")
    for (let py = iy + 1; py < iy + h - 1; py += 3) {
      pxRect(ctx, ix + 2, py, w - 4, 2, "#b45309")
      pxRect(ctx, ix + 2, py, 2, 2, "#d97706")
    }
    pxRect(ctx, ix, iy, 1, h, "#fcd34d")
    pxRect(ctx, ix + w - 1, iy, 1, h, "#b45309")
  }
}

// Build the cached static 512x320 terrain + cliff + forest + road base layer
export function renderStaticTerrain(): OffscreenCanvas {
  const canvas = new OffscreenCanvas(WORLD_W, WORLD_H)
  const ctx = canvas.getContext("2d")!
  ctx.imageSmoothingEnabled = false

  const img = ctx.createImageData(WORLD_W, WORLD_H)
  const data = img.data

  const setPx = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || x >= WORLD_W || y < 0 || y >= WORLD_H) return
    const idx = (y * WORLD_W + x) * 4
    data[idx] = r
    data[idx + 1] = g
    data[idx + 2] = b
    data[idx + 3] = 255
  }

  const landAt = (x: number, y: number) => {
    const f = islandField(x, y)
    const d = Math.min(f.mainDist, f.reefDist)
    return { ...f, d }
  }

  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      const f = landAt(x, y)
      const h = hash2(x, y)
      const dither = ((x + y) & 1) === 0

      const fAboveT3 = islandField(x, y - 11).tier3Dist
      const fAboveT2 = islandField(x, y - 9).tier2Dist
      const fAboveT1 = Math.min(islandField(x, y - 7).mainDist, islandField(x, y - 5).reefDist)

      // 1. Ocean & Reefs
      if (f.d > 0 && fAboveT1 > -2) {
        if (f.d < 3.5) {
          const c = dither ? [224, 242, 254] : [125, 211, 252]
          setPx(x, y, c[0]!, c[1]!, c[2]!)
        } else if (f.d < 13) {
          const c = f.d < 8 || dither ? [56, 189, 248] : [14, 165, 233]
          setPx(x, y, c[0]!, c[1]!, c[2]!)
        } else if (f.d < 28) {
          const c = f.d < 20 && dither ? [14, 165, 233] : [37, 99, 235]
          setPx(x, y, c[0]!, c[1]!, c[2]!)
        } else if (f.d < 52) {
          const c = dither && f.d < 38 ? [37, 99, 235] : [29, 75, 143]
          setPx(x, y, c[0]!, c[1]!, c[2]!)
        } else {
          const waveBand = Math.sin(x * 0.09 + y * 0.14) > 0.45 && dither
          const c = waveBand ? [26, 66, 128] : [20, 52, 100]
          setPx(x, y, c[0]!, c[1]!, c[2]!)
        }
        continue
      }

      // 2. South-facing sea cliff where land overhangs the water
      if (f.d > 0 && fAboveT1 <= -2) {
        const stripe = x % 5 === 0
        const c = stripe ? [92, 45, 22] : dither ? [133, 66, 30] : [168, 88, 38]
        setPx(x, y, c[0]!, c[1]!, c[2]!)
        continue
      }

      // 3. Rivers & Crystal Lagoon inside the island
      if (f.lagoonDist < 0 || f.riverDist < 0) {
        const edge = f.lagoonDist > -2.5 || f.riverDist > -1.4
        if (edge) {
          setPx(x, y, 125, 211, 252)
        } else if (f.lagoonDist < -10) {
          setPx(x, y, dither ? 14 : 2, dither ? 165 : 132, dither ? 233 : 199)
        } else {
          setPx(x, y, 56, 189, 248)
        }
        continue
      }

      // 4. Tier 3 Northern Citadel Cliff Wall & Summit
      if (f.tier3Dist > 0 && fAboveT3 < 0) {
        const col = x % 6 === 0 ? [92, 45, 22] : x % 3 === 0 ? [133, 66, 30] : [180, 102, 48]
        const rim = islandField(x, y - 1).tier3Dist < 0
        if (rim) setPx(x, y, 21, 128, 61)
        else setPx(x, y, col[0]!, col[1]!, col[2]!)
        continue
      }
      if (f.tier3Dist <= 0) {
        const rim = f.tier3Dist > -2.2
        if (rim) {
          setPx(x, y, 134, 239, 172)
        } else {
          const c = h > 0.82 ? [74, 222, 128] : dither ? [34, 197, 94] : [22, 163, 74]
          setPx(x, y, c[0]!, c[1]!, c[2]!)
        }
        continue
      }

      // 5. Tier 2 Cliff Wall & Highland Plateaus
      if (f.tier2Dist > 0 && fAboveT2 < 0) {
        const isVolc = f.volcanoDist < 12
        const col = isVolc
          ? x % 5 === 0
            ? [45, 28, 34]
            : [78, 46, 42]
          : x % 6 === 0
            ? [92, 45, 22]
            : x % 3 === 0
              ? [146, 74, 34]
              : [194, 112, 54]
        const rim = islandField(x, y - 1).tier2Dist < 0
        if (rim) setPx(x, y, isVolc ? 120 : 21, isVolc ? 53 : 128, isVolc ? 15 : 61)
        else setPx(x, y, col[0]!, col[1]!, col[2]!)
        continue
      }
      if (f.tier2Dist <= 0) {
        if (f.volcanoDist < 0) {
          const lavaRing = f.volcanoDist > -14 && f.volcanoDist < -8
          if (lavaRing) {
            const c = dither ? [249, 115, 22] : [220, 38, 38]
            setPx(x, y, c[0]!, c[1]!, c[2]!)
          } else {
            const c = dither ? [68, 52, 56] : [52, 38, 44]
            setPx(x, y, c[0]!, c[1]!, c[2]!)
          }
        } else {
          const rim = f.tier2Dist > -2.0
          if (rim) setPx(x, y, 134, 239, 172)
          else {
            const c = h > 0.8 ? [74, 222, 128] : dither ? [34, 197, 94] : [22, 163, 74]
            setPx(x, y, c[0]!, c[1]!, c[2]!)
          }
        }
        continue
      }

      // 6. Eastern Haunted Reef Island (Old Docs Quarter)
      if (f.reefDist <= 0) {
        if (f.reefDist > -4.5) {
          const c = dither ? [203, 213, 225] : [148, 163, 184]
          setPx(x, y, c[0]!, c[1]!, c[2]!)
        } else {
          const c = dither ? [71, 105, 96] : [51, 82, 78]
          setPx(x, y, c[0]!, c[1]!, c[2]!)
        }
        continue
      }

      // 7. Golden Sandy Beaches along the coast
      if (f.d > -6.5) {
        if (f.d > -1.8) {
          setPx(x, y, 180, 120, 60)
        } else {
          const c = h > 0.85 ? [254, 240, 138] : dither ? [247, 207, 115] : [234, 179, 84]
          setPx(x, y, c[0]!, c[1]!, c[2]!)
        }
        continue
      }

      // 8. Main Island Emerald Lowlands
      const nearStar = Math.hypot(x - 118, y - 222) < 48
      if (nearStar) {
        const c = h > 0.82 ? [94, 234, 212] : dither ? [20, 184, 166] : [13, 148, 136]
        setPx(x, y, c[0]!, c[1]!, c[2]!)
      } else {
        const c = h > 0.84 ? [74, 222, 128] : dither ? [34, 197, 94] : [22, 163, 74]
        setPx(x, y, c[0]!, c[1]!, c[2]!)
      }
    }
  }

  ctx.putImageData(img, 0, 0)

  // Draw carved stone stairways up the cliff faces
  const drawCliffStairs = (sx: number, sy: number, steps = 5) => {
    pxRect(ctx, sx - 5, sy, 10, steps * 2 + 2, "#44403c")
    for (let i = 0; i < steps; i++) {
      pxRect(ctx, sx - 4, sy + i * 2, 8, 1, "#e7e5e4")
      pxRect(ctx, sx - 4, sy + i * 2 + 1, 8, 1, "#78716c")
    }
  }
  drawCliffStairs(248, 108, 6) // Royal stairs down from Grand Keep
  drawCliffStairs(124, 144, 5) // Stairs down from Windmill Village
  drawCliffStairs(366, 138, 5) // Stairs down from Magma Foundry

  // Draw small decorative sea rocks & coral atolls in the ocean
  const seaRocks: [number, number, number][] = [
    [42, 74, 1],
    [66, 48, 0],
    [442, 62, 1],
    [474, 118, 0],
    [46, 266, 1],
    [192, 286, 0],
    [392, 282, 1],
    [482, 276, 0],
  ]
  for (const [rx, ry, big] of seaRocks) {
    pxRect(ctx, rx - 5, ry + 1, big ? 11 : 8, 3, "#38bdf8")
    pxRect(ctx, rx - 4, ry - (big ? 4 : 2), big ? 9 : 6, big ? 5 : 3, "#64748b")
    pxRect(ctx, rx - 3, ry - (big ? 5 : 3), big ? 6 : 4, 2, "#94a3b8")
    pxRect(ctx, rx - 2, ry - (big ? 5 : 3), 2, 1, "#e2e8f0")
  }

  // Draw pixel flowers & grass tufts across the meadows
  for (let y = 52; y < 276; y += 6) {
    for (let x = 58; x < 465; x += 6) {
      const h = hash2(x * 3, y * 7)
      if (h < 0.78) continue
      const f = islandField(x, y)
      if (f.mainDist > -10 || f.lagoonDist < 6 || f.riverDist < 6 || f.volcanoDist < 8) continue
      const fx = x + Math.floor(hash2(x, y) * 4)
      const fy = y + Math.floor(hash2(y, x) * 4)
      const flowerCol = h > 0.93 ? "#fde047" : h > 0.86 ? "#f472b6" : "#ffffff"
      pxRect(ctx, fx, fy, 2, 1, "#15803d")
      pxRect(ctx, fx, fy - 1, 1, 1, flowerCol)
    }
  }

  // Draw Overworld Path network (tan road bed + dotted stepping stones)
  for (const edge of PATH_EDGES) {
    const pts = edge.points
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i]!
      const [bx, by] = pts[i + 1]!
      const len = Math.hypot(bx - ax, by - ay)
      const steps = Math.ceil(len * 1.5)
      for (let s = 0; s <= steps; s++) {
        const t = s / Math.max(1, steps)
        const px = Math.round(ax + (bx - ax) * t)
        const py = Math.round(ay + (by - ay) * t)
        pxRect(ctx, px - 3, py - 2, 6, 5, "#78350f")
      }
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i]!
      const [bx, by] = pts[i + 1]!
      const len = Math.hypot(bx - ax, by - ay)
      const steps = Math.ceil(len * 1.5)
      for (let s = 0; s <= steps; s++) {
        const t = s / Math.max(1, steps)
        const px = Math.round(ax + (bx - ax) * t)
        const py = Math.round(ay + (by - ay) * t)
        pxRect(ctx, px - 2, py - 1, 4, 3, "#d97706")
      }
    }
  }

  // Draw wooden bridges over water/rivers
  for (const edge of PATH_EDGES) {
    if (edge.bridgeAt) {
      const b = edge.bridgeAt
      drawBridge(ctx, b.x, b.y, b.w, b.h, b.vertical)
    }
  }

  // Draw crisp SMW yellow/cream path stepping dots along every path edge
  for (const edge of PATH_EDGES) {
    const pts = edge.points
    let accum = 0
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i]!
      const [bx, by] = pts[i + 1]!
      const segLen = Math.hypot(bx - ax, by - ay)
      let d = 5 - (accum % 7)
      while (d < segLen) {
        const t = d / segLen
        const dx = Math.round(ax + (bx - ax) * t)
        const dy = Math.round(ay + (by - ay) * t)
        pxRect(ctx, dx - 1, dy - 1, 3, 3, "#451a03")
        pxRect(ctx, dx - 1, dy - 1, 2, 2, "#fef08a")
        d += 7
      }
      accum += segLen
    }
    // Intermediate sub-stage node (SMW red/gold dot) at midpoint of each road
    if (pts.length >= 2) {
      const mid = pts[Math.floor(pts.length / 2)]!
      const mx = Math.round(mid[0])
      const my = Math.round(mid[1])
      const isBossRoad = edge.from === 0 || edge.to === 2 || edge.to === 4
      pxRect(ctx, mx - 3, my - 2, 7, 5, "#451a03")
      pxRect(ctx, mx - 2, my - 1, 5, 3, isBossRoad ? "#ef4444" : "#fbbf24")
      pxRect(ctx, mx - 1, my - 1, 2, 1, "#fef9c3")
    }
  }

  // Plant lush 16-bit forests around landmarks (with generous clearance around landmarks & labels)
  const isNearPathOrLandmark = (x: number, y: number): boolean => {
    for (const lm of LANDMARK_META) {
      if (Math.hypot(x - lm.x, y - lm.y) < 38) return true
      if (Math.hypot(x - (lm.x + lm.heroOffset[0]), y - (lm.y + lm.heroOffset[1])) < 18) return true
      if (Math.hypot(x - (lm.x + lm.labelOffset[0]), y - (lm.y + lm.labelOffset[1])) < 26) return true
    }
    for (const edge of PATH_EDGES) {
      for (let i = 0; i < edge.points.length - 1; i++) {
        const [ax, ay] = edge.points[i]!
        const [bx, by] = edge.points[i + 1]!
        const l2 = (bx - ax) ** 2 + (by - ay) ** 2
        const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (l2 || 1)))
        const px = ax + t * (bx - ax)
        const py = ay + t * (by - ay)
        if (Math.hypot(x - px, y - py) < 11) return true
      }
    }
    return false
  }

  const trees: { x: number; y: number; kind: "pine" | "round" | "illusion" | "autumn" | "palm" | "dead" }[] = []
  for (let y = 52; y < 276; y += 11) {
    for (let x = 62; x < 474; x += 12) {
      const jx = x + Math.floor((hash2(x, y) - 0.5) * 6)
      const jy = y + Math.floor((hash2(y, x) - 0.5) * 6)
      if (hash2(jx + 17, jy + 31) < 0.42) continue
      if (isNearPathOrLandmark(jx, jy)) continue
      const f = islandField(jx, jy)
      if (f.riverDist < 8 || f.lagoonDist < 8 || f.volcanoDist < 18) continue

      if (f.reefDist < -5) {
        trees.push({ x: jx, y: jy, kind: "dead" })
      } else if (f.mainDist < -2 && f.mainDist > -8 && jy > 180) {
        trees.push({ x: jx, y: jy, kind: "palm" })
      } else if (f.mainDist < -9) {
        if (Math.hypot(jx - 118, jy - 222) < 52) {
          trees.push({ x: jx, y: jy, kind: "illusion" })
        } else if (jy < 130) {
          trees.push({ x: jx, y: jy, kind: "pine" })
        } else if (jx > 280 && jy < 195) {
          trees.push({ x: jx, y: jy, kind: "autumn" })
        } else {
          trees.push({ x: jx, y: jy, kind: "round" })
        }
      }
    }
  }

  trees.sort((a, b) => a.y - b.y)
  for (const t of trees) {
    if (t.kind === "pine") drawPineTree(ctx, t.x, t.y, (t.x + t.y) & 1)
    else if (t.kind === "palm") drawPalmTree(ctx, t.x, t.y)
    else if (t.kind === "illusion") drawRoundTree(ctx, t.x, t.y, "illusion")
    else if (t.kind === "autumn") drawRoundTree(ctx, t.x, t.y, "autumn")
    else if (t.kind === "dead") drawRoundTree(ctx, t.x, t.y, "dead")
    else drawRoundTree(ctx, t.x, t.y, "green")
  }

  return canvas
}

// ── Landmark 1: Grand Keep / Guardia Citadel (Monorepo Heights) ──────────────
function drawGrandKeep(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, time: number, focused: boolean) {
  const ix = Math.round(x)
  const iy = Math.round(y)
  pxRect(ctx, ix - 24, iy + 8, 48, 6, "rgba(10, 20, 35, 0.45)")

  // Dark pixel outline around outer curtain wall
  pxRect(ctx, ix - 21, iy - 9, 42, 22, "#0f172a")
  pxRect(ctx, ix - 20, iy - 8, 40, 20, "#64748b")
  pxRect(ctx, ix - 19, iy - 7, 38, 18, "#94a3b8")
  pxRect(ctx, ix - 18, iy - 6, 36, 16, "#cbd5e1")

  // Left & Right Flanking Towers
  for (const side of [-1, 1]) {
    const tx = ix + side * 16 - 5
    pxRect(ctx, tx - 1, iy - 18, 12, 30, "#0f172a")
    pxRect(ctx, tx, iy - 17, 10, 28, "#94a3b8")
    pxRect(ctx, tx + 1, iy - 17, 4, 28, "#e2e8f0")
    // Blue conical tower roof with dark outline
    pxRect(ctx, tx - 2, iy - 22, 14, 5, "#1e3a8a")
    pxRect(ctx, tx - 1, iy - 26, 12, 4, "#2563eb")
    pxRect(ctx, tx + 1, iy - 30, 8, 4, "#3b82f6")
    pxRect(ctx, tx + 3, iy - 33, 4, 3, "#60a5fa")
    pxRect(ctx, tx + 4, iy - 36, 2, 3, "#fbbf24")
    pxRect(ctx, tx + 4, iy - 12, 2, 4, "#fbbf24")
  }

  // Central High Keep
  pxRect(ctx, ix - 11, iy - 24, 22, 34, "#0f172a")
  pxRect(ctx, ix - 10, iy - 23, 20, 32, "#cbd5e1")
  pxRect(ctx, ix - 9, iy - 23, 8, 32, "#f1f5f9")
  for (let cx = ix - 10; cx <= ix + 8; cx += 4) {
    pxRect(ctx, cx, iy - 26, 2, 3, "#e2e8f0")
  }
  // Royal Blue Central Spire Roof
  pxRect(ctx, ix - 9, iy - 30, 18, 4, "#1e40af")
  pxRect(ctx, ix - 7, iy - 34, 14, 4, "#2563eb")
  pxRect(ctx, ix - 5, iy - 38, 10, 4, "#3b82f6")
  pxRect(ctx, ix - 2, iy - 41, 4, 3, "#60a5fa")
  pxRect(ctx, ix - 1, iy - 44, 2, 3, "#facc15")

  // Grand arched portcullis gate
  pxRect(ctx, ix - 5, iy + 1, 10, 11, "#1e293b")
  pxRect(ctx, ix - 4, iy, 8, 12, "#0f172a")
  for (let gx = ix - 3; gx <= ix + 3; gx += 2) {
    pxRect(ctx, gx, iy + 1, 1, 10, "#64748b")
  }
  // Glowing stained glass window
  pxRect(ctx, ix - 3, iy - 16, 6, 6, "#0f172a")
  pxRect(ctx, ix - 2, iy - 15, 4, 4, focused ? "#fef08a" : "#fbbf24")

  // 3 Animated fluttering crimson banners
  const wave = Math.floor(time * 8) % 3
  const bannerCoords: [number, number][] = [
    [ix, iy - 44],
    [ix - 16, iy - 36],
    [ix + 16, iy - 36],
  ]
  for (const [bx, by] of bannerCoords) {
    pxRect(ctx, bx + 1, by, 6, 3, "#dc2626")
    pxRect(ctx, bx + 2, by + (wave === 0 ? 0 : 1), 5, 2, "#ef4444")
    pxRect(ctx, bx + 6, by + (wave === 1 ? -1 : 1), 3, 2, "#fca5a5")
  }

  // Always-visible crackling Boss Lightning / Sparks flanking the Citadel spires!
  const sparkPhase = Math.floor(time * 8) % 2
  for (const side of [-1, 1]) {
    const lx = ix + side * 24 + (sparkPhase === 0 ? 0 : side)
    const ly = iy - 34
    pxRect(ctx, lx, ly, 2, 3, "#fef08a")
    pxRect(ctx, lx - side * 2, ly + 3, 3, 2, "#facc15")
    pxRect(ctx, lx, ly + 5, 2, 3, "#ffffff")
  }
}

// ── Landmark 2: Toadstool / Windmill Village (Side Project Suburbs) ──────────
function drawWindmillVillage(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, time: number) {
  const ix = Math.round(x)
  const iy = Math.round(y)

  // White picket fence behind village
  for (let fx = ix - 22; fx <= ix + 20; fx += 4) {
    pxRect(ctx, fx, iy + 6, 2, 5, "#f8fafc")
  }
  pxRect(ctx, ix - 22, iy + 8, 44, 1, "#cbd5e1")

  // Left Spotted Mushroom House (Toad House!)
  const mx = ix - 13
  const my = iy + 2
  pxRect(ctx, mx - 6, my + 5, 12, 3, "rgba(10, 28, 18, 0.38)")
  pxRect(ctx, mx - 6, my - 3, 12, 10, "#451a03")
  pxRect(ctx, mx - 5, my - 2, 10, 8, "#fef3c7")
  pxRect(ctx, mx - 4, my - 2, 8, 8, "#fffbeb")
  pxRect(ctx, mx - 2, my + 1, 4, 5, "#78350f")
  // Red spotted mushroom cap with crisp dark outline
  pxRect(ctx, mx - 9, my - 8, 18, 7, "#450a0a")
  pxRect(ctx, mx - 8, my - 7, 16, 6, "#b91c1c")
  pxRect(ctx, mx - 7, my - 10, 14, 7, "#ef4444")
  pxRect(ctx, mx - 5, my - 12, 10, 3, "#f87171")
  pxRect(ctx, mx - 5, my - 8, 3, 3, "#ffffff")
  pxRect(ctx, mx + 2, my - 9, 3, 3, "#ffffff")
  pxRect(ctx, mx - 1, my - 11, 2, 2, "#ffffff")

  // Right Tall Windmill Tower
  const wx = ix + 7
  const wy = iy + 2
  pxRect(ctx, wx - 7, wy + 5, 14, 3, "rgba(10, 28, 18, 0.4)")
  pxRect(ctx, wx - 7, wy - 15, 14, 22, "#451a03")
  pxRect(ctx, wx - 6, wy - 14, 12, 20, "#92400e")
  pxRect(ctx, wx - 5, wy - 14, 10, 20, "#d97706")
  pxRect(ctx, wx - 4, wy - 14, 5, 20, "#f59e0b")
  // Conical shingle roof
  pxRect(ctx, wx - 7, wy - 17, 14, 3, "#991b1b")
  pxRect(ctx, wx - 5, wy - 20, 10, 3, "#dc2626")
  pxRect(ctx, wx - 3, wy - 22, 6, 2, "#ef4444")
  pxRect(ctx, wx - 2, wy, 4, 6, "#451a03")
  pxRect(ctx, wx - 1, wy - 8, 3, 3, "#fef08a")

  // Animated 4-blade Windmill Sails
  const hubX = wx
  const hubY = wy - 13
  const angle = time * 1.8
  for (let b = 0; b < 4; b++) {
    const a = angle + (b * Math.PI) / 2
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    for (let r = 2; r <= 12; r++) {
      const bx = Math.round(hubX + ca * r)
      const by = Math.round(hubY + sa * r)
      pxRect(ctx, bx, by, 2, 2, r > 4 ? "#fef3c7" : "#451a03")
      if (r >= 5 && r % 2 === 0) {
        const px = Math.round(bx - sa * 2)
        const py = Math.round(by + ca * 2)
        pxRect(ctx, px, py, 2, 2, "#fde68a")
      }
    }
  }
  pxRect(ctx, hubX - 1, hubY - 1, 3, 3, "#451a03")
  pxRect(ctx, hubX, hubY, 1, 1, "#fbbf24")
}

// ── Landmark 3: Vanilla Dome / Magma Foundry (Legacy Industrial Park) ────────
function drawMagmaFoundry(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, time: number) {
  const ix = Math.round(x)
  const iy = Math.round(y)

  // Glowing animated Lava Moat around the foundry
  const lavaPulse = Math.floor(time * 6) % 2 === 0
  pxRect(ctx, ix - 22, iy + 2, 44, 9, "#7f1d1d")
  pxRect(ctx, ix - 20, iy + 3, 40, 7, lavaPulse ? "#ea580c" : "#dc2626")
  pxRect(ctx, ix - 16, iy + 5, 32, 3, lavaPulse ? "#facc15" : "#f97316")
  const bubX = ix - 12 + (Math.floor(time * 9) % 24)
  pxRect(ctx, bubX, iy + 4, 3, 2, "#fef08a")

  // Brass & Iron Industrial Dome Fortress with crisp dark outline
  pxRect(ctx, ix - 17, iy - 13, 34, 18, "#0f172a")
  pxRect(ctx, ix - 15, iy - 16, 30, 19, "#1e293b")
  pxRect(ctx, ix - 14, iy - 15, 28, 17, "#334155")
  pxRect(ctx, ix - 11, iy - 19, 22, 16, "#475569")
  pxRect(ctx, ix - 7, iy - 22, 14, 6, "#64748b")
  // Copper/Brass armor bands & rivets
  pxRect(ctx, ix - 15, iy - 8, 30, 3, "#b45309")
  pxRect(ctx, ix - 15, iy - 7, 30, 1, "#f59e0b")
  for (let rx = ix - 13; rx <= ix + 13; rx += 5) {
    pxRect(ctx, rx, iy - 13, 2, 2, "#fbbf24")
  }

  // Twin Industrial Smokestacks
  for (const sx of [ix - 11, ix + 7]) {
    pxRect(ctx, sx - 1, iy - 28, 6, 12, "#0f172a")
    pxRect(ctx, sx, iy - 28, 4, 12, "#334155")
    pxRect(ctx, sx + 1, iy - 28, 2, 12, "#64748b")
    pxRect(ctx, sx - 1, iy - 29, 6, 2, "#f59e0b")
    for (let p = 0; p < 3; p++) {
      const age = (time * 1.6 + p * 0.33 + (sx > ix ? 0.5 : 0)) % 1
      const py = Math.round(iy - 31 - age * 14)
      const px = Math.round(sx + 1 + Math.sin(age * 6 + p) * 3)
      const sz = age < 0.5 ? 4 : 6
      const shade = age < 0.4 ? "#94a3b8" : age < 0.75 ? "#cbd5e1" : "#f1f5f9"
      pxRect(ctx, px - sz / 2, py - sz / 2, sz, sz - 1, shade)
    }
  }

  // Glowing Blast Furnace Mouth
  pxRect(ctx, ix - 6, iy - 5, 12, 9, "#0f172a")
  pxRect(ctx, ix - 4, iy - 3, 8, 7, "#dc2626")
  pxRect(ctx, ix - 3, iy - 1, 6, 5, lavaPulse ? "#fef08a" : "#f97316")
  pxRect(ctx, ix - 2, iy - 3, 1, 3, "#0f172a")
  pxRect(ctx, ix + 1, iy - 3, 1, 3, "#0f172a")
}

// ── Landmark 4: Star Sanctuary / Forest of Illusion (Idea Gardens) ───────────
function drawStarSanctuary(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, time: number) {
  const ix = Math.round(x)
  const iy = Math.round(y)

  const ripple = Math.floor(time * 5) % 2
  pxRect(ctx, ix - 16 + ripple * 2, iy + 6, 6, 1, "#bae6fd")
  pxRect(ctx, ix + 10 - ripple * 2, iy - 8, 5, 1, "#e0f2fe")

  // Marble Island Shrine Base inside the Lagoon
  pxRect(ctx, ix - 14, iy - 4, 28, 12, "#0369a1")
  pxRect(ctx, ix - 13, iy - 5, 26, 11, "#1e293b")
  pxRect(ctx, ix - 12, iy - 4, 24, 9, "#cbd5e1")
  pxRect(ctx, ix - 11, iy - 5, 22, 8, "#f8fafc")

  // 4 Ancient Marble Pillars around the Star Road pad
  for (const px of [ix - 10, ix + 8]) {
    pxRect(ctx, px - 1, iy - 16, 5, 13, "#1e293b")
    pxRect(ctx, px, iy - 15, 3, 11, "#e2e8f0")
    pxRect(ctx, px, iy - 15, 2, 11, "#ffffff")
    pxRect(ctx, px - 1, iy - 17, 5, 2, "#bae6fd")
    pxRect(ctx, px, iy - 19, 3, 2, "#38bdf8")
  }

  // Golden 5-Pointed Star Road Warp Pad (Super Mario World Star Road!)
  const pulse = Math.sin(time * 5) > 0
  const starCol = pulse ? "#fef08a" : "#fbbf24"
  pxRect(ctx, ix - 5, iy - 5, 11, 7, "#78350f")
  pxRect(ctx, ix - 4, iy - 4, 9, 5, "#d97706")
  pxRect(ctx, ix - 3, iy - 4, 7, 4, starCol)
  pxRect(ctx, ix - 1, iy - 8, 3, 4, starCol)
  pxRect(ctx, ix - 6, iy - 3, 3, 2, starCol)
  pxRect(ctx, ix + 4, iy - 3, 3, 2, starCol)
  pxRect(ctx, ix - 4, iy + 1, 3, 3, starCol)
  pxRect(ctx, ix + 2, iy + 1, 3, 3, starCol)
  pxRect(ctx, ix - 1, iy - 3, 1, 2, "#0f172a")
  pxRect(ctx, ix + 1, iy - 3, 1, 2, "#0f172a")

  // 3 Orbiting Twinkling Star Sprites
  for (let s = 0; s < 3; s++) {
    const a = time * 2.4 + (s * Math.PI * 2) / 3
    const sx = Math.round(ix + Math.cos(a) * 16)
    const sy = Math.round(iy - 10 + Math.sin(a * 2) * 4)
    pxRect(ctx, sx - 1, sy, 3, 1, "#fef08a")
    pxRect(ctx, sx, sy - 1, 1, 3, "#ffffff")
  }
}

// ── Landmark 5: Yoshi's Homestead (Household Quarter) ────────────────────────
function drawYoshisHomestead(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, time: number) {
  const ix = Math.round(x)
  const iy = Math.round(y)

  // Fenced vegetable & berry garden patch on the right
  pxRect(ctx, ix + 8, iy - 3, 14, 9, "#451a03")
  pxRect(ctx, ix + 9, iy - 2, 12, 7, "#713f12")
  for (let gx = ix + 10; gx <= ix + 18; gx += 4) {
    pxRect(ctx, gx, iy - 1, 2, 2, "#22c55e")
    pxRect(ctx, gx + 1, iy - 2, 1, 1, "#ef4444")
    pxRect(ctx, gx, iy + 2, 2, 2, "#22c55e")
    pxRect(ctx, gx, iy + 1, 1, 1, "#f97316")
  }

  // Cute Green-and-White Spotted Yoshi Egg in a cozy nest!
  pxRect(ctx, ix + 12, iy - 8, 6, 5, "#14532d")
  pxRect(ctx, ix + 13, iy - 9, 4, 6, "#ffffff")
  pxRect(ctx, ix + 13, iy - 8, 2, 2, "#22c55e")
  pxRect(ctx, ix + 15, iy - 6, 2, 2, "#22c55e")

  // Cozy Cottage Shadow
  pxRect(ctx, ix - 16, iy + 5, 26, 4, "rgba(10, 28, 18, 0.4)")

  // Stone Chimney on Left with Rising Smoke Rings
  pxRect(ctx, ix - 13, iy - 18, 4, 18, "#44403c")
  pxRect(ctx, ix - 13, iy - 18, 2, 18, "#a8a29e")
  for (let p = 0; p < 2; p++) {
    const age = (time * 1.2 + p * 0.5) % 1
    const sx = Math.round(ix - 12 - Math.sin(age * 5) * 2)
    const sy = Math.round(iy - 20 - age * 12)
    pxRect(ctx, sx, sy, 3, 2, "#f8fafc")
  }

  // Timber & Cream Cottage Walls with dark outline
  pxRect(ctx, ix - 12, iy - 7, 22, 14, "#451a03")
  pxRect(ctx, ix - 10, iy - 5, 18, 11, "#fef3c7")
  // Warm terracotta shingle pitched roof
  pxRect(ctx, ix - 15, iy - 10, 28, 5, "#450a0a")
  pxRect(ctx, ix - 14, iy - 9, 26, 4, "#991b1b")
  pxRect(ctx, ix - 12, iy - 13, 22, 4, "#dc2626")
  pxRect(ctx, ix - 9, iy - 16, 16, 3, "#ef4444")
  pxRect(ctx, ix - 6, iy - 18, 10, 2, "#f87171")

  // Arched Wooden Door & Glowing Window
  pxRect(ctx, ix - 6, iy - 1, 4, 7, "#92400e")
  pxRect(ctx, ix - 3, iy + 2, 1, 1, "#fbbf24")
  pxRect(ctx, ix + 1, iy - 3, 5, 4, "#451a03")
  pxRect(ctx, ix + 2, iy - 2, 3, 2, "#fde047")

  // Red Mailbox out front with bouncing urgent `!` alert
  const mx = ix - 16
  const my = iy + 3
  pxRect(ctx, mx, my, 2, 5, "#78350f")
  pxRect(ctx, mx - 2, my - 3, 5, 3, "#dc2626")
  pxRect(ctx, mx - 1, my - 3, 3, 1, "#fca5a5")
  const bob = Math.round(Math.sin(time * 8) * 1.5)
  pxRect(ctx, mx - 2, my - 11 + bob, 5, 6, "#fef08a")
  pxRect(ctx, mx, my - 10 + bob, 1, 3, "#dc2626")
  pxRect(ctx, mx, my - 6 + bob, 1, 1, "#dc2626")
}

// ── Landmark 6: Millennial Fairground (Social Campus) ────────────────────────
function drawMillennialFair(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, time: number) {
  const ix = Math.round(x)
  const iy = Math.round(y)

  // Stone Cobble Festival Plaza with dark outline
  pxRect(ctx, ix - 21, iy + 1, 42, 10, "#1e293b")
  pxRect(ctx, ix - 20, iy + 2, 40, 8, "#94a3b8")
  pxRect(ctx, ix - 18, iy + 3, 36, 6, "#cbd5e1")

  // Centerpiece: Bell of Nadia Tower (Chrono Trigger Leene Square!)
  pxRect(ctx, ix - 6, iy - 22, 3, 25, "#334155")
  pxRect(ctx, ix + 3, iy - 22, 3, 25, "#334155")
  pxRect(ctx, ix - 5, iy - 22, 2, 25, "#e2e8f0")
  pxRect(ctx, ix + 3, iy - 22, 2, 25, "#e2e8f0")
  pxRect(ctx, ix - 7, iy - 26, 14, 4, "#1e293b")
  pxRect(ctx, ix - 5, iy - 29, 10, 3, "#0284c7")
  pxRect(ctx, ix - 2, iy - 31, 4, 2, "#fbbf24")
  // Swinging Golden Bell inside the arch
  const swing = Math.round(Math.sin(time * 5) * 1.5)
  pxRect(ctx, ix - 2 + swing, iy - 20, 4, 4, "#f59e0b")
  pxRect(ctx, ix - 3 + swing, iy - 17, 6, 2, "#fef08a")

  // Left Striped Circus Tent (Red & White)
  const lx = ix - 14
  const ly = iy + 2
  pxRect(ctx, lx - 7, ly - 7, 14, 9, "#450a0a")
  for (let s = -6; s <= 5; s += 2) {
    const col = ((s + 6) / 2) % 2 === 0 ? "#ef4444" : "#ffffff"
    pxRect(ctx, lx + s, ly - 6, 2, 7, col)
  }
  pxRect(ctx, lx - 5, ly - 10, 10, 4, "#dc2626")
  pxRect(ctx, lx - 3, ly - 13, 6, 3, "#fef08a")
  pxRect(ctx, lx - 1, ly - 16, 2, 3, "#ec4899")

  // Right Striped Festival Pavilion (Purple & Gold)
  const rx = ix + 14
  const ry = iy + 2
  pxRect(ctx, rx - 7, ry - 7, 14, 9, "#2e1065")
  for (let s = -6; s <= 5; s += 2) {
    const col = ((s + 6) / 2) % 2 === 0 ? "#9333ea" : "#fef08a"
    pxRect(ctx, rx + s, ry - 6, 2, 7, col)
  }
  pxRect(ctx, rx - 5, ry - 10, 10, 4, "#7e22ce")
  pxRect(ctx, rx - 3, ry - 13, 6, 3, "#fbbf24")
  pxRect(ctx, rx - 1, ry - 16, 2, 3, "#38bdf8")

  // Festive Bunting Pennants strung between tower and tents
  const colors = ["#ef4444", "#fbbf24", "#22c55e", "#38bdf8", "#ec4899"]
  for (let i = 0; i < 5; i++) {
    pxRect(ctx, ix - 13 + i * 2, iy - 14 + (i % 2), 2, 2, colors[i]!)
    pxRect(ctx, ix + 5 + i * 2, iy - 14 + (i % 2), 2, 2, colors[(i + 2) % 5]!)
  }
}

// ── Landmark 7: Sunken Ghost Ship / Haunted Ruins (Old Docs Quarter) ─────────
function drawSunkenGhostShip(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, time: number) {
  const ix = Math.round(x)
  const iy = Math.round(y) + Math.round(Math.sin(time * 2.2) * 1)

  pxRect(ctx, ix - 16, iy + 6, 32, 2, "#7dd3fc")

  // Tilted Wooden Galleon Hull with dark outline
  pxRect(ctx, ix - 17, iy - 5, 32, 12, "#0f172a")
  pxRect(ctx, ix - 14, iy - 1, 28, 7, "#334155")
  pxRect(ctx, ix - 16, iy - 4, 30, 5, "#475569")
  pxRect(ctx, ix - 12, iy - 2, 24, 4, "#64748b")
  pxRect(ctx, ix + 6, iy - 10, 10, 7, "#1e293b")
  pxRect(ctx, ix + 7, iy - 9, 8, 5, "#334155")
  pxRect(ctx, ix + 9, iy - 7, 2, 2, "#67e8f9")
  pxRect(ctx, ix - 20, iy - 6, 5, 2, "#334155")

  // Broken Main Mast & Tattered Purple/Grey Sails
  pxRect(ctx, ix - 2, iy - 24, 2, 20, "#1e293b")
  pxRect(ctx, ix - 9, iy - 20, 15, 2, "#334155")
  const sway = Math.floor(time * 4) % 2
  pxRect(ctx, ix - 8, iy - 18, 14, 7, "#475569")
  pxRect(ctx, ix - 7, iy - 17, 12, 5, "#94a3b8")
  // Tiny skull mark on sail
  pxRect(ctx, ix - 2, iy - 16, 3, 3, "#0f172a")
  pxRect(ctx, ix - 7 + sway, iy - 11, 3, 4, "#94a3b8")
  pxRect(ctx, ix - 1 + sway, iy - 11, 4, 5, "#64748b")
  pxRect(ctx, ix + 4 + sway, iy - 11, 2, 3, "#94a3b8")

  // Orbiting Cute 16-Bit Pixel Ghost (SMW Boo style!)
  const gx = Math.round(ix + Math.cos(time * 2.3) * 16)
  const gy = Math.round(iy - 16 + Math.sin(time * 4.6) * 3)
  pxRect(ctx, gx - 4, gy - 4, 9, 8, "#0f172a")
  pxRect(ctx, gx - 3, gy - 3, 7, 6, "#e2e8f0")
  pxRect(ctx, gx - 2, gy - 4, 5, 7, "#ffffff")
  pxRect(ctx, gx - 4, gy + 2, 2, 2, "#ffffff")
  pxRect(ctx, gx - 1, gy - 2, 1, 2, "#0f172a")
  pxRect(ctx, gx + 1, gy - 2, 1, 2, "#0f172a")
  pxRect(ctx, gx, gy + 1, 2, 1, "#f43f5e")
}

// Draw landmark stage pad on the road network + urgency badge above landmark
function drawLandmarkPadAndBadge(
  ctx: OffscreenCanvasRenderingContext2D,
  lm: LandmarkNode,
  time: number,
  isFocused: boolean,
) {
  const px = Math.round(lm.x + lm.heroOffset[0])
  const py = Math.round(lm.y + lm.heroOffset[1])
  const urgent = lm.district.urgent > 0

  // Classic SMW Stage Node Pad where the hero stands
  pxRect(ctx, px - 6, py - 3, 12, 7, "#451a03")
  pxRect(ctx, px - 5, py - 2, 10, 5, isFocused ? "#fef08a" : "#fbbf24")
  pxRect(ctx, px - 3, py - 1, 6, 3, urgent ? "#ef4444" : "#38bdf8")
  if (isFocused) {
    const expand = Math.floor(time * 6) % 2
    pxRect(ctx, px - 7 - expand, py - 4 - expand, 14 + expand * 2, 1, "#fef08a")
    pxRect(ctx, px - 7 - expand, py + 3 + expand, 14 + expand * 2, 1, "#fef08a")
  }

  // Bobbing urgent boss indicator (`!` badge) above landmarks with urgent items
  if (urgent) {
    const bob = Math.round(Math.sin(time * 7 + lm.index) * 2)
    const bx = Math.round(lm.x + 15)
    const by = Math.round(lm.y - 26 + bob)
    pxRect(ctx, bx - 4, by - 5, 9, 10, "#0f172a")
    pxRect(ctx, bx - 3, by - 4, 7, 8, "#ef4444")
    pxRect(ctx, bx - 2, by - 3, 5, 1, "#fca5a5")
    pxRect(ctx, bx, by - 2, 2, 3, "#fef08a")
    pxRect(ctx, bx, by + 2, 2, 1, "#fef08a")
  }
}

// ── 16-Bit Animated Hero Traveler Sprite ─────────────────────────────────────
export function drawHeroTraveler(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  time: number,
  isWalking: boolean,
  facingLeft: boolean,
) {
  const ix = Math.round(x)
  const runFrame = isWalking ? Math.floor(time * 14) % 4 : 0
  const hop = isWalking ? (runFrame % 2 === 1 ? -2 : 0) : Math.floor(time * 3.5) % 2 === 0 ? 0 : -1
  const iy = Math.round(y) + hop
  const dir = facingLeft ? -1 : 1

  if (isWalking) {
    for (let d = 1; d <= 2; d++) {
      const dx = ix - dir * (4 + d * 3)
      const dy = Math.round(y) - ((Math.floor(time * 16) + d) % 3)
      pxRect(ctx, dx - 1, dy - 1, 3, 2, "#fef3c7")
    }
  }

  pxRect(ctx, ix - 5, Math.round(y) + 1, 10, 3, "rgba(10, 18, 32, 0.55)")
  pxRect(ctx, ix - 5, iy - 15, 10, 16, "#0f172a")

  const capeWave = Math.floor(time * (isWalking ? 14 : 5)) % 2
  const capeX = facingLeft ? ix + 2 : ix - 7
  pxRect(ctx, capeX, iy - 9 + capeWave, 5, 7, "#991b1b")
  pxRect(ctx, capeX + (facingLeft ? 0 : 1), iy - 8 + capeWave, 4, 5, "#ef4444")

  const stride = isWalking ? (runFrame === 1 ? 2 : runFrame === 3 ? -2 : 0) : 0
  pxRect(ctx, ix - 3 + stride, iy - 2, 3, 3, "#78350f")
  pxRect(ctx, ix + 1 - stride, iy - 2, 3, 3, "#78350f")

  pxRect(ctx, ix - 4, iy - 8, 8, 6, "#1d4ed8")
  pxRect(ctx, ix - 3, iy - 8, 6, 5, "#3b82f6")
  pxRect(ctx, ix - 4, iy - 4, 8, 1, "#fbbf24")
  pxRect(ctx, ix - dir * 4, iy - 7, 2, 2, "#fef08a")

  pxRect(ctx, ix - 3, iy - 13, 6, 5, "#fed7aa")
  pxRect(ctx, ix - 4, iy - 13, 2, 3, "#9a3412")
  const eyeX = facingLeft ? ix - 3 : ix + 1
  pxRect(ctx, eyeX, iy - 11, 1, 2, "#0f172a")

  pxRect(ctx, ix - 4, iy - 15, 8, 3, "#dc2626")
  pxRect(ctx, ix - 3, iy - 16, 6, 2, "#ef4444")
  pxRect(ctx, ix + dir * 2, iy - 14, 3, 1, "#b91c1c")
  pxRect(ctx, ix - dir * 3, iy - 18, 2, 3, "#ffffff")
  pxRect(ctx, ix - dir * 4, iy - 19, 2, 2, "#e2e8f0")

  const arrowBob = Math.round(Math.sin(time * 7) * 1.5)
  const ay = iy - 24 + arrowBob
  pxRect(ctx, ix - 3, ay - 3, 6, 2, "#0f172a")
  pxRect(ctx, ix - 2, ay - 2, 4, 2, "#fef08a")
  pxRect(ctx, ix - 1, ay, 2, 2, "#fbbf24")
}

// ── Ambient World Animations (Waves, Waterfalls, Clouds, Airship) ────────────
function drawAmbientWorld(ctx: OffscreenCanvasRenderingContext2D, time: number) {
  // 1. Animated Ocean Wave Crests & Sparkles
  const waveTick = Math.floor(time * 3.5)
  for (let i = 0; i < 42; i++) {
    const wx = Math.round(((i * 97 + 23) % (WORLD_W - 24)) + 12)
    const wy = Math.round(((i * 53 + 19) % (WORLD_H - 24)) + 12)
    const f = islandField(wx, wy)
    if (f.mainDist < 10 || f.reefDist < 10) continue
    const phase = (waveTick + i) % 4
    const shift = phase === 1 ? 1 : phase === 2 ? 2 : 0
    if (phase < 3) {
      pxRect(ctx, wx + shift, wy, 5, 1, "#7dd3fc")
      pxRect(ctx, wx + shift + 1, wy - 1, 3, 1, "#e0f2fe")
    }
  }

  // 2. Twin Northern Waterfalls cascading from Citadel Summit into the rivers (above the bridges!)
  const fallScroll = Math.floor(time * 18)
  for (const fx of [202, 294]) {
    const fy0 = 96
    const fy1 = 114
    pxRect(ctx, fx - 4, fy0, 8, fy1 - fy0, "#0284c7")
    pxRect(ctx, fx - 3, fy0, 6, fy1 - fy0, "#38bdf8")
    for (let y = fy0; y < fy1; y += 2) {
      const foam = (y + fallScroll) % 6 < 3
      pxRect(ctx, fx - 2, y, 4, 1, foam ? "#ffffff" : "#bae6fd")
    }
    const splash = Math.floor(time * 10) % 2
    pxRect(ctx, fx - 5, fy1 - 1, 10, 3, "#e0f2fe")
    pxRect(ctx, fx - 4 + splash, fy1 - 2, 7, 2, "#ffffff")
  }

  // 3. Soft Drifting Cloud Shadows & Fluffy Pixel Clouds at top corners
  const clouds = [
    { baseX: 40, y: 54, w: 28 },
    { baseX: 332, y: 48, w: 32 },
    { baseX: 434, y: 168, w: 26 },
  ]
  for (const c of clouds) {
    const cx = Math.round(((c.baseX + time * 4.5) % (WORLD_W + 60)) - 30)
    pxRect(ctx, cx + 4, c.y + 18, c.w - 4, 5, "rgba(8, 20, 44, 0.22)")
    pxRect(ctx, cx, c.y, c.w, 6, "#cbd5e1")
    pxRect(ctx, cx + 2, c.y - 3, c.w - 4, 7, "#f8fafc")
    pxRect(ctx, cx + 6, c.y - 5, c.w - 12, 4, "#ffffff")
  }

  // 4. Tiny Chrono Trigger "Epoch" / 16-Bit Airship cruising across the sky!
  const shipX = Math.round(((time * 14 + 70) % (WORLD_W + 80)) - 40)
  const shipY = Math.round(58 + Math.sin(time * 2.5) * 3)
  pxRect(ctx, shipX - 5, shipY + 26, 10, 3, "rgba(10, 20, 40, 0.28)")
  pxRect(ctx, shipX - 6, shipY - 2, 12, 4, "#92400e")
  pxRect(ctx, shipX - 5, shipY - 3, 10, 3, "#f59e0b")
  pxRect(ctx, shipX - 4, shipY - 6, 8, 3, "#fef3c7")
  pxRect(ctx, shipX - 2, shipY - 7, 4, 1, "#ef4444")
  const prop = Math.floor(time * 24) % 2
  pxRect(ctx, shipX - 8, shipY - 3 + prop, 2, 3, "#e2e8f0")
}

// Render the complete dynamic 512x320 world frame
export function renderOverworldFrame(
  ctx: OffscreenCanvasRenderingContext2D,
  staticTerrain: OffscreenCanvas,
  landmarks: ReadonlyArray<LandmarkNode>,
  hero: { x: number; y: number; walking: boolean; facingLeft: boolean },
  focus: number,
  time: number,
) {
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, WORLD_W, WORLD_H)
  ctx.drawImage(staticTerrain, 0, 0)

  for (const lm of landmarks) {
    drawLandmarkPadAndBadge(ctx, lm, time, focus === lm.index)
  }

  drawGrandKeep(ctx, landmarks[0]!.x, landmarks[0]!.y, time, focus === 0)
  drawMagmaFoundry(ctx, landmarks[2]!.x, landmarks[2]!.y, time)
  drawWindmillVillage(ctx, landmarks[1]!.x, landmarks[1]!.y, time)
  drawYoshisHomestead(ctx, landmarks[4]!.x, landmarks[4]!.y, time)
  drawStarSanctuary(ctx, landmarks[3]!.x, landmarks[3]!.y, time)
  drawSunkenGhostShip(ctx, landmarks[6]!.x, landmarks[6]!.y, time)
  drawMillennialFair(ctx, landmarks[5]!.x, landmarks[5]!.y, time)

  drawHeroTraveler(ctx, hero.x, hero.y, time, hero.walking, hero.facingLeft)
  drawAmbientWorld(ctx, time)
}
