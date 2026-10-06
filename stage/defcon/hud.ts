import { Kind, type QuadLayer } from "../core/gpu"
import { clamp, Spring } from "../core/motion"
import { THEMES, type DefconRenderer, type PhosphorTheme } from "./renderer"
import type { SectorNode, Theater, Vec2 } from "./theater"

// Strategic Situation Room skin:
// Renders vector coastlines, bathymetry contours, radar sweeps, installation glyphs,
// ballistic arcs with live warhead blips, and the NORAD/HighFleet tactical HUD.

interface Clickable {
  x: number
  y: number
  w: number
  h: number
  run: () => void
}

const FONT_MONO = "600 {px} 'Silkscreen', ui-monospace, 'SF Mono', Menlo, monospace"
const FONT_SANS = "600 {px} 'PixelifySans', ui-monospace, 'SF Mono', Menlo, monospace"

export function defconSkin(r: DefconRenderer, theater: Theater) {
  const q: QuadLayer = r.quads
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches

  const cam = {
    x: new Spring(theater.width * 0.5, 5.5, 1),
    y: new Spring(theater.height * 0.5, 5.5, 1),
    logZoom: new Spring(0, 5.5, 1),
  }
  const dossierSlide = new Spring(0, 8, 1)

  let W = 1280
  let H = 800
  let sized = false
  let focus = -1
  let hover = -1
  let themeIdx = 0
  const buttons: Clickable[] = []

  const zoom = () => Math.exp(cam.logZoom.x)
  const worldToScreen = (wx: number, wy: number): [number, number] => {
    const k = zoom()
    return [(wx - cam.x.x) * k + W * 0.5, (wy - cam.y.x) * k + H * 0.5]
  }
  const screenToWorld = (sx: number, sy: number): [number, number] => {
    const k = zoom()
    return [(sx - W * 0.5) / k + cam.x.x, (sy - H * 0.5) / k + cam.y.x]
  }

  function fitOverview(snap = false) {
    const padX = 80
    const padY = 120
    const k = Math.min((W - padX) / theater.width, (H - padY) / theater.height)
    const tx = theater.width * 0.5
    const ty = theater.height * 0.5 + 8
    const lz = Math.log(Math.max(0.25, k))
    if (snap || reduced) {
      cam.x.snap(tx)
      cam.y.snap(ty)
      cam.logZoom.snap(lz)
    } else {
      cam.x.set(tx)
      cam.y.set(ty)
      cam.logZoom.set(lz)
    }
  }

  function select(i: number) {
    if (i < 0 || i >= theater.sectors.length) return back()
    focus = i
    dossierSlide.set(1)
    if (reduced) dossierSlide.snap(1)
    const sec = theater.sectors[i]!
    const targetK = Math.min((W * 0.46) / (sec.radius * 2.3), (H * 0.56) / (sec.radius * 2.3))
    // Offset camera slightly right in world space so sector centers nicely to the left of the right-hand dossier
    const offsetWorldX = (180 / targetK)
    if (reduced) {
      cam.x.snap(sec.center.x + offsetWorldX)
      cam.y.snap(sec.center.y)
      cam.logZoom.snap(Math.log(targetK))
    } else {
      cam.x.set(sec.center.x + offsetWorldX)
      cam.y.set(sec.center.y)
      cam.logZoom.set(Math.log(targetK))
    }
  }

  function back() {
    focus = -1
    dossierSlide.set(0)
    if (reduced) dossierSlide.snap(0)
    fitOverview(false)
  }

  function cycleTheme(dir = 1) {
    themeIdx = (themeIdx + dir + THEMES.length) % THEMES.length
  }

  function drawPoly(
    pts: Vec2[],
    color: [number, number, number, number],
    width = 1.5,
    glow = 2.5,
    dashPeriod = 0,
    dashOffset = 0,
  ) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!
      const b = pts[(i + 1) % pts.length]!
      r.pushSegment({ x0: a.x, y0: a.y, x1: b.x, y1: b.y, color, width, glow, dashPeriod, dashOffset })
    }
  }

  function drawCircleWorld(
    cx: number,
    cy: number,
    rad: number,
    segs: number,
    color: [number, number, number, number],
    width = 1.3,
    glow = 2.0,
    dashPeriod = 0,
    rot = 0,
  ) {
    for (let i = 0; i < segs; i++) {
      const a0 = rot + (i / segs) * Math.PI * 2
      const a1 = rot + ((i + 1) / segs) * Math.PI * 2
      r.pushSegment({
        x0: cx + Math.cos(a0) * rad,
        y0: cy + Math.sin(a0) * rad,
        x1: cx + Math.cos(a1) * rad,
        y1: cy + Math.sin(a1) * rad,
        color,
        width,
        glow,
        dashPeriod,
      })
    }
  }

  function drawInstallationWorld(
    x: number,
    y: number,
    kind: "silo" | "radar" | "airbase" | "fleet",
    color: [number, number, number, number],
    scale = 1,
    time = 0,
  ) {
    const s = 7.5 * scale
    if (kind === "silo") {
      // Tactical missile silo triangle + inner core
      r.pushSegment({ x0: x, y0: y - s * 1.15, x1: x + s, y1: y + s * 0.8, color, width: 1.8, glow: 3.0 })
      r.pushSegment({ x0: x + s, y0: y + s * 0.8, x1: x - s, y1: y + s * 0.8, color, width: 1.8, glow: 3.0 })
      r.pushSegment({ x0: x - s, y0: y + s * 0.8, x1: x, y1: y - s * 1.15, color, width: 1.8, glow: 3.0 })
    } else if (kind === "radar") {
      // Octagonal radar station + rotating dish bar
      drawCircleWorld(x, y, s * 1.15, 8, color, 1.6, 2.8)
      const a = time * 1.8
      r.pushSegment({
        x0: x - Math.cos(a) * s * 1.5,
        y0: y - Math.sin(a) * s * 1.5,
        x1: x + Math.cos(a) * s * 1.5,
        y1: y + Math.sin(a) * s * 1.5,
        color,
        width: 2.0,
        glow: 3.5,
      })
    } else if (kind === "airbase") {
      // Diamond airfield symbol
      r.pushSegment({ x0: x, y0: y - s, x1: x + s, y1: y, color, width: 1.5, glow: 2.4 })
      r.pushSegment({ x0: x + s, y0: y, x1: x, y1: y + s, color, width: 1.5, glow: 2.4 })
      r.pushSegment({ x0: x, y0: y + s, x1: x - s, y1: y, color, width: 1.5, glow: 2.4 })
      r.pushSegment({ x0: x - s, y0: y, x1: x, y1: y - s, color, width: 1.5, glow: 2.4 })
    } else {
      // Naval / fleet bracket box
      r.pushSegment({ x0: x - s, y0: y - s * 0.7, x1: x + s, y1: y - s * 0.7, color, width: 1.5, glow: 2.2 })
      r.pushSegment({ x0: x + s, y0: y - s * 0.7, x1: x + s * 0.65, y1: y + s * 0.7, color, width: 1.5, glow: 2.2 })
      r.pushSegment({ x0: x + s * 0.65, y0: y + s * 0.7, x1: x - s * 0.65, y1: y + s * 0.7, color, width: 1.5, glow: 2.2 })
      r.pushSegment({ x0: x - s * 0.65, y0: y + s * 0.7, x1: x - s, y1: y - s * 0.7, color, width: 1.5, glow: 2.2 })
    }
  }

  function drawWorldVectors(time: number, theme: PhosphorTheme) {
    r.resetSegments()

    // Outer world border frame
    const borderCol: [number, number, number, number] = [...theme.grid, 0.75]
    drawPoly(
      [
        { x: 0, y: 0 },
        { x: theater.width, y: 0 },
        { x: theater.width, y: theater.height },
        { x: 0, y: theater.height },
      ],
      borderCol,
      1.6,
      2.5,
    )

    // Ambient outer landmasses
    for (const bgPoly of theater.bgContinents) {
      drawPoly(bgPoly, [...theme.grid, 0.55], 1.2, 1.8)
    }

    // Draw each strategic sector's continent, bathymetry shelf, inner topography, and airspace
    for (const sec of theater.sectors) {
      const isFocused = focus === sec.index
      const isHovered = hover === sec.index
      const dimFactor = focus >= 0 && !isFocused ? 0.38 : 1.0
      const urgent = sec.district.urgent > 0

      // Continental shelf bathymetry contour (dashed)
      drawPoly(sec.shelfContour, [...theme.grid, 0.55 * dimFactor], 1.0, 1.6, 10, time * 8)

      // Inner elevation contour
      drawPoly(sec.innerContour, [...theme.inner, 0.68 * dimFactor], 1.2, 2.0)

      // Primary glowing coastline
      const coastBoost = isFocused ? 1.25 : isHovered ? 1.12 : 0.92
      drawPoly(
        sec.coast,
        [theme.coast[0] * coastBoost, theme.coast[1] * coastBoost, theme.coast[2] * coastBoost, 0.95 * dimFactor],
        isFocused ? 2.4 : 1.85,
        isFocused ? 4.5 : 3.2,
      )

      // Tactical polygonal airspace perimeter
      const airCol = urgent ? theme.alert : theme.friendly
      drawPoly(
        sec.airspace,
        [...airCol, (isFocused ? 0.88 : 0.48) * dimFactor],
        isFocused ? 1.8 : 1.2,
        isFocused ? 3.5 : 2.2,
        14,
        -time * 12,
      )

      // Rotating radar sweep vector arm inside sector
      const ang = sec.radarPhase + time * sec.radarSpeed
      const rLen = sec.radius * 1.12
      const sweepCol = urgent ? theme.alert : theme.coast
      r.pushSegment({
        x0: sec.center.x,
        y0: sec.center.y,
        x1: sec.center.x + Math.cos(ang) * rLen,
        y1: sec.center.y + Math.sin(ang) * rLen,
        color: [...sweepCol, 0.85 * dimFactor],
        width: 1.8,
        glow: 3.8,
      })

      // Pulsing threat target rings around urgent sectors
      if (urgent) {
        const pulse = (time * 0.65 + sec.index * 0.27) % 1
        const pRad = sec.radius * (0.35 + pulse * 0.85)
        drawCircleWorld(sec.center.x, sec.center.y, pRad, 28, [...theme.alert, (1 - pulse) * 0.72 * dimFactor], 1.5, 3.0)
      }

      // Focus lock reticle around selected sector
      if (isFocused || isHovered) {
        const lockR = sec.radius * 1.22
        const c = sec.center
        const bLen = 24
        const lockCol: [number, number, number, number] = isFocused ? [...theme.text, 0.95] : [...theme.coast, 0.7]
        for (const [sx, sy] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ] as const) {
          const cx = c.x + sx * lockR
          const cy = c.y + sy * lockR
          r.pushSegment({ x0: cx, y0: cy, x1: cx - sx * bLen, y1: cy, color: lockCol, width: 2.2, glow: 3.5 })
          r.pushSegment({ x0: cx, y0: cy, x1: cx, y1: cy - sy * bLen, color: lockCol, width: 2.2, glow: 3.5 })
        }
      }

      // Installations (radar, missile silos, airbases, naval fleets)
      for (const inst of sec.installations) {
        const col = inst.urgent ? theme.alert : inst.kind === "radar" ? theme.coast : theme.friendly
        drawInstallationWorld(inst.x, inst.y, inst.kind, [...col, 0.95 * dimFactor], isFocused ? 1.15 : 0.95, time)
      }
    }

    // Ballistic trajectories & sortie arcs
    const steps = 24
    for (const trk of theater.tracks) {
      const relevant = focus < 0 || trk.sectorIdx === focus
      const dim = relevant ? 1.0 : 0.22
      const baseCol = trk.urgent ? theme.alert : theme.track
      const headT = (trk.phase + time * trk.speed) % 1

      const bez = (t: number): Vec2 => {
        const u = 1 - t
        return {
          x: u * u * trk.from.x + 2 * u * t * trk.ctrl.x + t * t * trk.to.x,
          y: u * u * trk.from.y + 2 * u * t * trk.ctrl.y + t * t * trk.to.y,
        }
      }

      for (let s = 0; s < steps; s++) {
        const t0 = s / steps
        const t1 = (s + 1) / steps
        const p0 = bez(t0)
        const p1 = bez(t1)
        if (t1 <= headT) {
          // Burned phosphor wake behind the warhead/sortie
          const trailFade = Math.pow(t1 / Math.max(0.01, headT), 1.6)
          r.pushSegment({
            x0: p0.x,
            y0: p0.y,
            x1: p1.x,
            y1: p1.y,
            color: [...baseCol, (0.25 + 0.72 * trailFade) * dim],
            width: trk.urgent ? 2.1 : 1.4,
            glow: trk.urgent ? 4.0 : 2.4,
          })
        } else {
          // Predicted dashed trajectory ahead of the warhead
          r.pushSegment({
            x0: p0.x,
            y0: p0.y,
            x1: p1.x,
            y1: p1.y,
            color: [...baseCol, 0.32 * dim],
            width: 1.1,
            glow: 1.5,
            dashPeriod: 9,
          })
        }
      }

      // Live warhead / aircraft blip at headT
      const hp = bez(headT)
      const sz = trk.urgent ? 5.5 : 4.0
      r.pushSegment({ x0: hp.x - sz, y0: hp.y, x1: hp.x + sz, y1: hp.y, color: [1, 0.96, 0.88, 0.95 * dim], width: 2.0, glow: 4.5 })
      r.pushSegment({ x0: hp.x, y0: hp.y - sz, x1: hp.x, y1: hp.y + sz, color: [1, 0.96, 0.88, 0.95 * dim], width: 2.0, glow: 4.5 })

      // Target impact diamond on urgent ballistic tracks
      if (trk.urgent && relevant) {
        const ir = 8 + 3 * Math.sin(time * 5 + trk.phase * 6)
        drawCircleWorld(trk.to.x, trk.to.y, ir, 4, [...theme.alert, 0.9 * dim], 1.8, 3.5, 0, time * 1.5)
      }
    }
  }

  // ── HUD & Telemetry Overlay (QuadLayer) ───────────────────────────────────────

  function drawText(
    str: string,
    x: number,
    y: number,
    px: number,
    color: [number, number, number, number],
    align: "left" | "center" | "right" = "left",
    font = FONT_MONO,
    spacing = 0.5,
  ) {
    const e = q.text(str, px, font, spacing)
    const ox = align === "center" ? -e.w * 0.5 : align === "right" ? -e.w : 0
    q.push({
      kind: Kind.text,
      x: Math.round(x + ox),
      y: Math.round(y - e.h * 0.5),
      w: e.w,
      h: e.h,
      uv: e.uv,
      color,
      alpha: color[3],
    })
    return e.w
  }

  function drawPanel(
    x: number,
    y: number,
    w: number,
    h: number,
    fill: [number, number, number, number],
    border: [number, number, number, number],
    cornerLen = 8,
  ) {
    q.push({ kind: Kind.rect, x, y, w, h, color: fill, alpha: fill[3] })
    q.push({ kind: Kind.rect, x, y, w, h, stroke: 1.2, color: border, alpha: border[3] * 0.65 })
    // Crisp HighFleet/DEFCON corner brackets
    const c = [border[0], border[1], border[2], Math.min(1, border[3] * 1.25)] as [number, number, number, number]
    // Top-left
    q.push({ kind: Kind.rect, x: x - 1, y: y - 1, w: cornerLen, h: 2, color: c, alpha: c[3] })
    q.push({ kind: Kind.rect, x: x - 1, y: y - 1, w: 2, h: cornerLen, color: c, alpha: c[3] })
    // Top-right
    q.push({ kind: Kind.rect, x: x + w - cornerLen + 1, y: y - 1, w: cornerLen, h: 2, color: c, alpha: c[3] })
    q.push({ kind: Kind.rect, x: x + w - 1, y: y - 1, w: 2, h: cornerLen, color: c, alpha: c[3] })
    // Bottom-left
    q.push({ kind: Kind.rect, x: x - 1, y: y + h - 1, w: cornerLen, h: 2, color: c, alpha: c[3] })
    q.push({ kind: Kind.rect, x: x - 1, y: y + h - cornerLen + 1, w: 2, h: cornerLen, color: c, alpha: c[3] })
    // Bottom-right
    q.push({ kind: Kind.rect, x: x + w - cornerLen + 1, y: y + h - 1, w: cornerLen, h: 2, color: c, alpha: c[3] })
    q.push({ kind: Kind.rect, x: x + w - 1, y: y + h - cornerLen + 1, w: 2, h: cornerLen, color: c, alpha: c[3] })
  }

  function buildHud(time: number, theme: PhosphorTheme) {
    q.reset()
    buttons.length = 0

    // 1. World-pinned sector callout tags
    for (const sec of theater.sectors) {
      const [sx, sy] = worldToScreen(sec.center.x, sec.center.y - sec.radius * 0.78)
      if (sx < -120 || sx > W + 120 || sy < 42 || sy > H - 42) continue
      const isFocused = focus === sec.index
      const isHovered = hover === sec.index
      const dim = focus >= 0 && !isFocused ? 0.42 : 1.0
      const urgent = sec.district.urgent > 0
      const tagW = 186
      const tagH = 42
      const tx = Math.round(sx - tagW * 0.5)
      const ty = Math.round(sy - tagH - 10)

      const borderCol: [number, number, number, number] = urgent
        ? [...theme.alert, (isFocused ? 1 : 0.85) * dim]
        : [...theme.coast, (isFocused || isHovered ? 0.95 : 0.72) * dim]

      drawPanel(
        tx,
        ty,
        tagW,
        tagH,
        [theme.bg[0] * 0.9, theme.bg[1] * 0.9, theme.bg[2] * 0.9, 0.86 * dim],
        borderCol,
        6,
      )

      // Pin leader line down to sector center
      q.push({
        kind: Kind.rect,
        x: Math.round(sx - 0.75),
        y: ty + tagH,
        w: 1.5,
        h: 12,
        color: borderCol,
        alpha: borderCol[3],
      })

      drawText(
        `${sec.code} · ${sec.lat}`,
        tx + 8,
        ty + 12,
        9.5,
        [...theme.dim, 0.95 * dim],
        "left",
        FONT_MONO,
      )

      if (urgent) {
        const badgeW = 68
        q.push({
          kind: Kind.rect,
          x: tx + tagW - badgeW - 6,
          y: ty + 5,
          w: badgeW,
          h: 13,
          color: [...theme.alert, 0.9 * dim],
          alpha: 0.9 * dim,
        })
        drawText(
          `!${sec.district.urgent} THREAT`,
          tx + tagW - 6 - badgeW * 0.5,
          ty + 11.5,
          8.5,
          [0.02, 0.02, 0.03, dim],
          "center",
          FONT_MONO,
        )
      } else {
        drawText(
          `${sec.district.items.length} TRK`,
          tx + tagW - 8,
          ty + 12,
          9.5,
          [...theme.friendly, 0.9 * dim],
          "right",
          FONT_MONO,
        )
      }

      drawText(
        sec.district.name.toUpperCase(),
        tx + 8,
        ty + 29,
        12.5,
        [...theme.text, dim],
        "left",
        FONT_SANS,
      )

      buttons.push({ x: tx, y: ty, w: tagW, h: tagH, run: () => (focus === sec.index ? back() : select(sec.index)) })
    }

    // 2. Top Strategic Status Bar
    const topH = 48
    drawPanel(
      12,
      10,
      W - 24,
      topH,
      [theme.bg[0] * 0.85, theme.bg[1] * 0.85, theme.bg[2] * 0.85, 0.9],
      [...theme.coast, 0.8],
      9,
    )

    // DEFCON badge box
    const activeDefcon = focus >= 0 ? theater.sectors[focus]!.defcon : theater.defcon
    const defCol = activeDefcon <= 2 ? theme.alert : activeDefcon === 3 ? theme.track : theme.coast
    q.push({ kind: Kind.rect, x: 20, y: 17, w: 112, h: 34, color: [...defCol, 0.22], alpha: 0.95 })
    q.push({ kind: Kind.rect, x: 20, y: 17, w: 112, h: 34, stroke: 1.5, color: [...defCol, 0.95], alpha: 0.95 })
    drawText(`DEFCON ${activeDefcon}`, 76, 34, 15, [...defCol, 1], "center", FONT_MONO, 1)

    // Theater title & telemetry counters
    drawText(`${theater.title} // STRATEGIC COMMAND`, 148, 25, 13, [...theme.text, 1], "left", FONT_MONO)
    const totalTracks = theater.tracks.length
    const totalUrgent = theater.tracks.filter((t) => t.urgent).length
    drawText(
      `ACTIVE TRACKS: ${totalTracks}   IMPENDING STRIKES: ${totalUrgent}   MODE: ${ theme.name }`,
      148,
      42,
      10,
      [...theme.dim, 0.95],
      "left",
      FONT_MONO,
    )

    // Sector quick-lock buttons 01..07 on the right of the top bar
    const btnW = 48
    const startX = W - 24 - theater.sectors.length * (btnW + 6)
    theater.sectors.forEach((sec, idx) => {
      const bx = startX + idx * (btnW + 6)
      const by = 17
      const bh = 34
      const on = focus === idx
      const urg = sec.district.urgent > 0
      const bCol = on ? theme.text : urg ? theme.alert : theme.coast
      q.push({
        kind: Kind.rect,
        x: bx,
        y: by,
        w: btnW,
        h: bh,
        color: on ? [...bCol, 0.28] : [theme.bg[0], theme.bg[1], theme.bg[2], 0.85],
        alpha: 0.95,
      })
      q.push({ kind: Kind.rect, x: bx, y: by, w: btnW, h: bh, stroke: on ? 1.8 : 1.1, color: [...bCol, 0.9], alpha: 0.9 })
      drawText(`0${idx + 1}`, bx + btnW * 0.5, by + 12, 11, [...bCol, 1], "center", FONT_MONO)
      drawText(urg ? `!${sec.district.urgent}` : "OK", bx + btnW * 0.5, by + 25, 9, urg ? [...theme.alert, 1] : [...theme.friendly, 0.85], "center", FONT_MONO)
      buttons.push({ x: bx, y: by, w: btnW, h: bh, run: () => (focus === idx ? back() : select(idx)) })
    })

    // 3. Right-hand Tactical Dossier / Global Threat Log
    const panelW = 376
    const panelX = W - panelW - 14
    const panelY = 70
    if (focus >= 0) {
      const sec = theater.sectors[focus]!
      const items = sec.district.items
      const panelH = Math.min(H - 126, 152 + items.length * 64)
      drawPanel(
        panelX,
        panelY,
        panelW,
        panelH,
        [theme.bg[0] * 0.92, theme.bg[1] * 0.92, theme.bg[2] * 0.92, 0.93],
        [...(sec.district.urgent > 0 ? theme.alert : theme.coast), 0.9],
        10,
      )

      drawText(
        `${sec.code} // ${sec.district.kind.toUpperCase()} THEATER`,
        panelX + 16,
        panelY + 22,
        10,
        [...theme.dim, 1],
        "left",
        FONT_MONO,
      )
      drawText(sec.district.name.toUpperCase(), panelX + 16, panelY + 42, 17, [...theme.text, 1], "left", FONT_SANS)
      drawText(
        `COORDS ${sec.lat} ${sec.lon}   ·   READINESS DEFCON ${sec.defcon}`,
        panelX + 16,
        panelY + 62,
        9.5,
        [...theme.coast, 0.9],
        "left",
        FONT_MONO,
      )

      // Readiness bar
      const barY = panelY + 78
      q.push({ kind: Kind.rect, x: panelX + 16, y: barY, w: panelW - 32, h: 6, color: [...theme.grid, 0.5], alpha: 0.7 })
      q.push({
        kind: Kind.rect,
        x: panelX + 16,
        y: barY,
        w: (panelW - 32) * clamp(sec.district.activity, 0.15, 1),
        h: 6,
        color: [...(sec.district.urgent > 0 ? theme.alert : theme.friendly), 0.9],
        alpha: 0.9,
      })

      drawText(
        `ACTIVE INTERCEPT TRACKS (${items.length})`,
        panelX + 16,
        panelY + 104,
        10,
        [...theme.dim, 0.95],
        "left",
        FONT_MONO,
      )

      items.forEach((it, idx) => {
        const ry = panelY + 120 + idx * 62
        const urg = !!it.urgent
        const rowCol = urg ? theme.alert : theme.coast
        q.push({
          kind: Kind.rect,
          x: panelX + 14,
          y: ry,
          w: panelW - 28,
          h: 54,
          color: [...rowCol, urg ? 0.13 : 0.07],
          alpha: 0.9,
        })
        q.push({
          kind: Kind.rect,
          x: panelX + 14,
          y: ry,
          w: 3,
          h: 54,
          color: [...rowCol, 0.95],
          alpha: 0.95,
        })

        const code = `${urg ? "ICBM" : "TRK"}-0${sec.index + 1}0${idx + 1}`
        const status = urg ? "IMPENDING STRIKE" : "ORBITAL TRACK"
        drawText(`${code} // ${status}`, panelX + 26, ry + 16, 9.5, [...rowCol, 0.95], "left", FONT_MONO)
        if (it.when) {
          drawText(`WINDOW: ${it.when.toUpperCase()}`, panelX + panelW - 24, ry + 16, 9.5, [...(urg ? theme.alert : theme.track), 1], "right", FONT_MONO)
        }
        const title = it.title.length > 42 ? it.title.slice(0, 41) + "…" : it.title
        drawText(title, panelX + 26, ry + 37, 13, [...theme.text, 0.98], "left", FONT_SANS)
      })
    } else {
      // Compact global intercept summary board in overview mode
      const urgentTracks = theater.tracks.filter((t) => t.urgent).slice(0, 5)
      const panelH = 82 + urgentTracks.length * 46
      drawPanel(
        panelX,
        panelY,
        panelW,
        panelH,
        [theme.bg[0] * 0.88, theme.bg[1] * 0.88, theme.bg[2] * 0.88, 0.86],
        [...theme.alert, 0.78],
        8,
      )
      drawText("EARLY WARNING // PRIORITY THREAT LOG", panelX + 14, panelY + 20, 10.5, [...theme.alert, 1], "left", FONT_MONO)
      drawText("CLICK ANY SECTOR OR PRESS [1-7] FOR TACTICAL LOCK", panelX + 14, panelY + 38, 9, [...theme.dim, 0.9], "left", FONT_MONO)

      urgentTracks.forEach((trk, idx) => {
        const ry = panelY + 54 + idx * 44
        const sec = theater.sectors[trk.sectorIdx]!
        q.push({ kind: Kind.rect, x: panelX + 12, y: ry, w: panelW - 24, h: 38, color: [...theme.alert, 0.1], alpha: 0.85 })
        q.push({ kind: Kind.rect, x: panelX + 12, y: ry, w: 3, h: 38, color: [...theme.alert, 0.9], alpha: 0.95 })
        drawText(`${trk.code} -> ${sec.code}`, panelX + 22, ry + 12, 9, [...theme.alert, 0.95], "left", FONT_MONO)
        drawText(`T-${trk.when.toUpperCase()}`, panelX + panelW - 20, ry + 12, 9, [...theme.track, 0.95], "right", FONT_MONO)
        const title = trk.title.length > 42 ? trk.title.slice(0, 41) + "…" : trk.title
        drawText(title, panelX + 22, ry + 27, 11.5, [...theme.text, 0.95], "left", FONT_SANS)
        buttons.push({ x: panelX + 12, y: ry, w: panelW - 24, h: 38, run: () => select(trk.sectorIdx) })
      })
    }

    // 4. Bottom Telemetry & Controls Strip
    const botH = 34
    const botY = H - botH - 10
    drawPanel(
      12,
      botY,
      W - 24,
      botH,
      [theme.bg[0] * 0.85, theme.bg[1] * 0.85, theme.bg[2] * 0.85, 0.9],
      [...theme.grid, 0.85],
      7,
    )
    const statusText =
      focus >= 0
        ? `LOCKED: ${theater.sectors[focus]!.code} ${theater.sectors[focus]!.district.name.toUpperCase()}   ·   [ESC] GLOBAL PLOT`
        : "GLOBAL SURVEILLANCE ACTIVE   ·   ALL 7 COMMAND SECTORS ONLINE"
    drawText(statusText, 26, botY + 17, 10.5, [...theme.coast, 0.95], "left", FONT_MONO)
    drawText(
      "[1-7] SECTOR LOCK   [ESC] GLOBAL VIEW   [P] PHOSPHOR PALETTE",
      W - 26,
      botY + 17,
      10,
      [...theme.dim, 0.95],
      "right",
      FONT_MONO,
    )
  }

  function pick(sx: number, sy: number) {
    for (let i = buttons.length - 1; i >= 0; i--) {
      const b = buttons[i]!
      if (sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h) return { button: b }
    }
    const [wx, wy] = screenToWorld(sx, sy)
    let best = -1
    let bestD = Infinity
    for (const sec of theater.sectors) {
      const d = Math.hypot(wx - sec.center.x, wy - sec.center.y)
      if (d <= sec.radius * 1.15 && d < bestD) {
        best = sec.index
        bestD = d
      }
    }
    return { sector: best }
  }

  const input = {
    tap(sx: number, sy: number) {
      const h = pick(sx, sy)
      if ("button" in h && h.button) return h.button.run()
      if (h.sector !== undefined && h.sector >= 0) {
        if (focus === h.sector) back()
        else select(h.sector)
      } else if (focus >= 0) {
        back()
      }
    },
    hover(sx: number, sy: number) {
      const h = pick(sx, sy)
      hover = "button" in h ? -1 : (h.sector ?? -1)
    },
    pan(dx: number, dy: number) {
      const k = zoom()
      cam.x.snap(clamp(cam.x.x - dx / k, 0, theater.width))
      cam.y.snap(clamp(cam.y.x - dy / k, 0, theater.height))
    },
    zoom(f: number, sx: number, sy: number) {
      const [wx0, wy0] = screenToWorld(sx, sy)
      cam.logZoom.snap(clamp(cam.logZoom.x + Math.log(f), Math.log(0.45), Math.log(4.5)))
      const [wx1, wy1] = screenToWorld(sx, sy)
      cam.x.snap(cam.x.x + (wx0 - wx1))
      cam.y.snap(cam.y.x + (wy0 - wy1))
    },
    key(e: KeyboardEvent) {
      if (e.key === "Escape") back()
      else if (e.key === "p" || e.key === "P") cycleTheme(1)
      else if (e.key === "q" || e.key === "Q") cycleTheme(-1)
      else if (e.key === "e" || e.key === "E") cycleTheme(1)
      else if (e.key >= "1" && e.key <= "9") {
        const i = Number(e.key) - 1
        if (i < theater.sectors.length) select(i)
      }
    },
  }

  function frame(dt: number, time: number) {
    const [nw, nh] = r.size
    if (!sized || Math.abs(nw - W) > 1 || Math.abs(nh - H) > 1) {
      W = nw
      H = nh
      if (!sized) fitOverview(true)
      sized = true
    }

    cam.x.step(dt)
    cam.y.step(dt)
    cam.logZoom.step(dt)
    dossierSlide.step(dt)

    const theme = THEMES[themeIdx]!
    drawWorldVectors(time, theme)
    buildHud(time, theme)

    const sectorSweepUniforms: [number, number, number, number][] = theater.sectors.map((sec) => {
      const ang = ((sec.radarPhase + time * sec.radarSpeed) % (Math.PI * 2)) + 10.0
      const signed = sec.district.urgent > 0 ? -ang : ang
      return [sec.center.x, sec.center.y, sec.radius, signed]
    })

    r.render([cam.x.x, cam.y.x], zoom(), time, focus, themeIdx, theme, sectorSweepUniforms)
  }

  return { frame, input, select, back, cycleTheme }
}
