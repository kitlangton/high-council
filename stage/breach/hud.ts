import { Kind, type QuadLayer } from "../core/gpu"
import type { BoardTile, BreachBoard, SectorInfo } from "./board"
import type { PaletteMode } from "./sprites"

export interface HudHitRegion {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly onClick: () => void
}

export interface HudState {
  readonly board: BreachBoard
  readonly selectedSector: number | null
  readonly selectedTile: { gx: number; gy: number } | null
  readonly hoveredTile: { gx: number; gy: number } | null
  readonly turn: number
  readonly maxTurns: number
  readonly paletteMode: PaletteMode
  readonly time: number
  readonly onSelectSector: (idx: number | null) => void
  readonly onSelectTile: (gx: number, gy: number) => void
  readonly onEndTurn: () => void
  readonly onTogglePalette: () => void
}

const FONT_DISPLAY = "700 {px} 'PixelifySans', 'Silkscreen', ui-monospace, monospace"
const FONT_PIXEL = "400 {px} 'Silkscreen', 'PixelifySans', ui-monospace, monospace"

type RGBA = [number, number, number, number]

const C = {
  bgDeep: [0.05, 0.08, 0.13, 0.94] as RGBA,
  bgPanel: [0.08, 0.12, 0.19, 0.95] as RGBA,
  bgCard: [0.11, 0.16, 0.25, 0.95] as RGBA,
  bgHeader: [0.14, 0.20, 0.31, 0.98] as RGBA,
  borderOuter: [0.03, 0.05, 0.08, 1.0] as RGBA,
  borderSteel: [0.32, 0.43, 0.56, 1.0] as RGBA,
  borderBright: [0.58, 0.72, 0.86, 1.0] as RGBA,
  cyan: [0.22, 0.74, 0.97, 1.0] as RGBA,
  amber: [0.98, 0.75, 0.14, 1.0] as RGBA,
  orange: [0.98, 0.45, 0.09, 1.0] as RGBA,
  red: [0.94, 0.27, 0.27, 1.0] as RGBA,
  redDark: [0.35, 0.09, 0.11, 0.95] as RGBA,
  green: [0.29, 0.87, 0.50, 1.0] as RGBA,
  purple: [0.66, 0.55, 0.98, 1.0] as RGBA,
  white: [0.97, 0.98, 0.99, 1.0] as RGBA,
  muted: [0.58, 0.64, 0.72, 1.0] as RGBA,
  dim: [0.39, 0.45, 0.55, 1.0] as RGBA,
}

function rgbNorm(rgb: [number, number, number], a = 1): RGBA {
  return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, a]
}

export function renderTacticalHud(
  quads: QuadLayer,
  W: number,
  H: number,
  dpr: number,
  state: HudState,
): HudHitRegion[] {
  const hits: HudHitRegion[] = []
  const { board, selectedSector, selectedTile, hoveredTile, turn, maxTurns, paletteMode, time } = state
  const pulse = 0.5 + 0.5 * Math.sin(time * 5.5)
  const blink = (Math.floor(time * 4) & 1) === 0

  const rect = (x: number, y: number, w: number, h: number, color: RGBA, stroke = 0) => {
    quads.push({
      x: Math.round(x),
      y: Math.round(y),
      w: Math.round(w),
      h: Math.round(h),
      kind: Kind.rect,
      color,
      stroke,
    })
  }

  const glow = (x: number, y: number, w: number, h: number, color: RGBA, glowPx = 10) => {
    quads.push({
      x: Math.round(x),
      y: Math.round(y),
      w: Math.round(w),
      h: Math.round(h),
      kind: Kind.glow,
      color,
      glow: glowPx,
    })
  }

  // Pixel-art beveled tactical frame (chunky 2px outer dark rim + steel inner border + corner ticks)
  const pixelFrame = (
    x: number,
    y: number,
    w: number,
    h: number,
    fill: RGBA = C.bgPanel,
    border: RGBA = C.borderSteel,
    cornerColor: RGBA = C.cyan,
  ) => {
    const rx = Math.round(x)
    const ry = Math.round(y)
    const rw = Math.round(w)
    const rh = Math.round(h)
    // Drop shadow
    rect(rx + 3, ry + 3, rw, rh, [0.02, 0.03, 0.06, 0.75])
    // Outer dark metal shell
    rect(rx, ry, rw, rh, C.borderOuter)
    // Main panel fill
    rect(rx + 2, ry + 2, rw - 4, rh - 4, fill)
    // Inner steel 2px border
    rect(rx + 2, ry + 2, rw - 4, 2, border)
    rect(rx + 2, ry + rh - 4, rw - 4, 2, border)
    rect(rx + 2, ry + 2, 2, rh - 4, border)
    rect(rx + rw - 4, ry + 2, 2, rh - 4, border)
    // Corner pixel brackets (4x4 L-ticks)
    const cw = 6
    rect(rx + 2, ry + 2, cw, 2, cornerColor)
    rect(rx + 2, ry + 2, 2, cw, cornerColor)
    rect(rx + rw - 2 - cw, ry + 2, cw, 2, cornerColor)
    rect(rx + rw - 4, ry + 2, 2, cw, cornerColor)
    rect(rx + 2, ry + rh - 4, cw, 2, cornerColor)
    rect(rx + 2, ry + rh - 2 - cw, 2, cw, cornerColor)
    rect(rx + rw - 2 - cw, ry + rh - 4, cw, 2, cornerColor)
    rect(rx + rw - 4, ry + rh - 2 - cw, 2, cw, cornerColor)
  }

  const label = (
    str: string,
    x: number,
    y: number,
    px: number,
    color: RGBA = C.white,
    font = FONT_PIXEL,
    align: "left" | "center" | "right" = "left",
    shadow = true,
  ) => {
    if (!str) return { w: 0, h: 0 }
    const g = quads.text(str, px, font, 0, Math.max(2, Math.round(dpr)))
    const drawX = Math.round(align === "center" ? x - g.w / 2 : align === "right" ? x - g.w : x)
    const drawY = Math.round(y)
    if (shadow) {
      quads.push({
        x: drawX + 1,
        y: drawY + 1,
        w: g.w,
        h: g.h,
        kind: Kind.text,
        uv: g.uv,
        color: [0.02, 0.04, 0.07, color[3] * 0.9],
      })
    }
    quads.push({
      x: drawX,
      y: drawY,
      w: g.w,
      h: g.h,
      kind: Kind.text,
      uv: g.uv,
      color,
    })
    return g
  }

  const wrapLines = (str: string, maxChars: number): string[] => {
    const words = str.split(" ")
    const lines: string[] = []
    let cur = ""
    for (const w of words) {
      if (!cur) cur = w
      else if (cur.length + 1 + w.length <= maxChars) cur += " " + w
      else {
        lines.push(cur)
        cur = w
      }
    }
    if (cur) lines.push(cur)
    return lines.slice(0, 2)
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 1. TOP-LEFT POWER GRID BAR & TURN HEADER (Authentic Into the Breach HUD)
  // ══════════════════════════════════════════════════════════════════════════════
  const topX = 14
  const topY = 12
  const topW = Math.min(548, W - 392)
  const topH = 66
  pixelFrame(topX, topY, topW, topH, C.bgPanel, C.borderSteel, C.amber)

  // Left badge: POWER GRID Percentage & Shield Resist
  rect(topX + 8, topY + 8, 124, 50, C.bgHeader)
  rect(topX + 8, topY + 8, 4, 50, C.amber)
  label("POWER GRID", topX + 18, topY + 11, 10, C.amber, FONT_PIXEL)
  label(`${board.gridPowerPercent}%`, topX + 18, topY + 24, 21, C.white, FONT_DISPLAY)
  label(`DEF ${board.shieldResistPercent}%`, topX + 78, topY + 30, 10, C.cyan, FONT_PIXEL)

  // Center: 7 Glowing Orange/Gold Power Grid Battery Segments
  const segStartX = topX + 140
  const segY = topY + 25
  const segW = 20
  const segH = 24
  const segGap = 5
  label("CIVIC GRID CELLS · 6/7 ONLINE (1 THREATENED)", segStartX, topY + 9, 9, C.muted, FONT_PIXEL)

  for (let i = 0; i < board.gridBlocksTotal; i++) {
    const sx = segStartX + i * (segW + segGap)
    const isFilled = i < board.gridBlocksFilled
    const isThreatenedCell = i === board.gridBlocksFilled - 1 && board.threats.length > 0
    rect(sx - 2, segY - 2, segW + 4, segH + 4, C.borderOuter)
    rect(sx, segY, segW, segH, [0.12, 0.16, 0.22, 1])

    if (isFilled) {
      const col: RGBA = isThreatenedCell
        ? blink
          ? C.red
          : C.amber
        : i >= 4
          ? C.amber
          : C.orange
      if (isThreatenedCell) glow(sx, segY, segW, segH, [0.95, 0.3, 0.2, 0.35 * pulse], 8)
      rect(sx + 2, segY + 2, segW - 4, segH - 4, col)
      // Top specular pixel bar inside battery cell
      rect(sx + 3, segY + 3, segW - 6, 4, [1, 0.96, 0.75, 0.85])
    } else {
      rect(sx + 3, segY + 3, segW - 6, segH - 6, [0.06, 0.09, 0.14, 1])
    }
  }

  // Right of top bar: END TURN / RESET Button + Turn Readout + Palette Button
  const btnW = 104
  const btnH = 30
  const btnX = topX + topW - btnW - 10
  const btnY = topY + 9
  pixelFrame(btnX, btnY, btnW, btnH, [0.78, 0.34, 0.08, 1], C.amber, C.white)
  label(
    selectedSector !== null ? "OVERVIEW" : `END TURN ${turn}/${maxTurns}`,
    btnX + btnW / 2,
    btnY + 7,
    10,
    C.white,
    FONT_PIXEL,
    "center",
  )
  hits.push({
    id: "btn-end-turn",
    x: btnX,
    y: btnY,
    w: btnW,
    h: btnH,
    onClick: () => {
      if (selectedSector !== null) state.onSelectSector(null)
      else state.onEndTurn()
    },
  })

  // Palette Mode Toggle Button ([P] DAY / NIGHT)
  const palBtnX = btnX
  const palBtnY = topY + 42
  rect(palBtnX, palBtnY, btnW, 17, C.bgHeader)
  rect(palBtnX, palBtnY, 3, 17, paletteMode === "day" ? C.cyan : C.purple)
  label(
    `[P] ${paletteMode === "day" ? "DAY OPS" : "NIGHT GRID"}`,
    palBtnX + btnW / 2,
    palBtnY + 2,
    9,
    paletteMode === "day" ? C.cyan : C.purple,
    FONT_PIXEL,
    "center",
  )
  hits.push({
    id: "btn-palette",
    x: palBtnX,
    y: palBtnY,
    w: btnW,
    h: 17,
    onClick: state.onTogglePalette,
  })

  // ══════════════════════════════════════════════════════════════════════════════
  // 2. LEFT SQUAD MECH ROSTER & ISLAND TIMELINE BADGE
  // ══════════════════════════════════════════════════════════════════════════════
  const squadX = 14
  const squadY = 86
  const squadW = 188
  const mechRowH = 36
  const squadH = 28 + board.mechs.length * (mechRowH + 4) + 6
  pixelFrame(squadX, squadY, squadW, squadH, C.bgPanel, C.borderSteel, C.cyan)

  rect(squadX + 4, squadY + 4, squadW - 8, 20, C.bgHeader)
  label("DEFENSE SQUAD · 5 MECHS", squadX + 10, squadY + 7, 9, C.cyan, FONT_PIXEL)

  board.mechs.forEach((mech, idx) => {
    const ry = squadY + 28 + idx * (mechRowH + 4)
    const isSelectedMech =
      (selectedTile?.gx === mech.gx && selectedTile?.gy === mech.gy) ||
      selectedSector === mech.districtIndex
    const sector = board.sectors[mech.districtIndex]!
    const secCol = rgbNorm(sector.accentRgb)

    rect(squadX + 6, ry, squadW - 12, mechRowH, isSelectedMech ? [0.16, 0.24, 0.36, 0.98] : C.bgCard)
    rect(squadX + 6, ry, 4, mechRowH, isSelectedMech ? C.cyan : secCol)

    // Mech Callsign & Sector tag
    label(mech.name, squadX + 15, ry + 4, 10, C.white, FONT_PIXEL)
    label(sector.code, squadX + squadW - 12, ry + 4, 9, secCol, FONT_PIXEL, "right")

    // Weapon & Green HP Pips
    label(mech.weapon, squadX + 15, ry + 18, 9, C.muted, FONT_PIXEL)
    const pipStart = squadX + squadW - 12 - mech.maxHp * 8
    for (let p = 0; p < mech.maxHp; p++) {
      rect(pipStart + p * 8, ry + 20, 6, 8, C.borderOuter)
      rect(pipStart + p * 8 + 1, ry + 21, 4, 6, p < mech.hp ? C.green : C.dim)
    }

    hits.push({
      id: `mech-${mech.id}`,
      x: squadX + 6,
      y: ry,
      w: squadW - 12,
      h: mechRowH,
      onClick: () => {
        state.onSelectSector(mech.districtIndex)
        state.onSelectTile(mech.gx, mech.gy)
      },
    })
  })

  // Threat Counter Pill below Squad Roster
  const alertY = squadY + squadH + 8
  const totalUrgent = board.threats.length
  pixelFrame(squadX, alertY, squadW, 44, C.redDark, C.red, C.amber)
  label("VEK EMERGENCE ALERT", squadX + 12, alertY + 6, 9, C.amber, FONT_PIXEL)
  label(
    `${totalUrgent} URGENT TELEGRAPHS`,
    squadX + 12,
    alertY + 20,
    11,
    blink ? C.white : C.amber,
    FONT_PIXEL,
  )

  // ══════════════════════════════════════════════════════════════════════════════
  // 3. BOTTOM SECTOR QUICK-SELECT BAR (1–7 CORPORATE GRID ZONES)
  // ══════════════════════════════════════════════════════════════════════════════
  const botMargin = 14
  const botH = 68
  const botY = H - botH - 10
  const rightInspectorW = 358
  const availBotW = W - rightInspectorW - botMargin * 2 - 8
  const cardGap = 6
  const cardW = Math.floor((availBotW - cardGap * 6) / 7)

  board.sectors.forEach((sec, idx) => {
    const cx = botMargin + idx * (cardW + cardGap)
    const isSel = selectedSector === idx
    const secCol = rgbNorm(sec.accentRgb)
    const hasThreat = sec.threats.length > 0

    if (isSel) {
      glow(cx, botY - 2, cardW, botH + 4, [secCol[0], secCol[1], secCol[2], 0.35], 12)
    }

    pixelFrame(
      cx,
      isSel ? botY - 4 : botY,
      cardW,
      botH,
      isSel ? [0.14, 0.21, 0.33, 0.98] : C.bgPanel,
      isSel ? C.white : hasThreat ? C.red : C.borderSteel,
      secCol,
    )

    const cy = isSel ? botY - 4 : botY
    // Top color bar
    rect(cx + 4, cy + 4, cardW - 8, 16, C.bgHeader)
    rect(cx + 4, cy + 4, 18, 16, secCol)
    label(`${idx + 1}`, cx + 13, cy + 5, 10, [0.03, 0.05, 0.09, 1], FONT_PIXEL, "center", false)
    label(sec.code, cx + 26, cy + 5, 9, secCol, FONT_PIXEL)

    // Threat badge (! count) on top-right of card
    if (hasThreat) {
      const badgeW = 28
      rect(cx + cardW - badgeW - 5, cy + 4, badgeW, 16, blink ? C.red : C.amber)
      label(
        `!${sec.threats.length}`,
        cx + cardW - badgeW / 2 - 5,
        cy + 5,
        9,
        blink ? C.white : [0.05, 0.05, 0.08, 1],
        FONT_PIXEL,
        "center",
        false,
      )
    }

    // Sector short name (2 lines max, clean fit)
    const shortLines = wrapLines(sec.district.name.toUpperCase(), Math.max(10, Math.floor((cardW - 12) / 6.5)))
    shortLines.forEach((ln, li) => {
      label(ln, cx + 7, cy + 23 + li * 12, 10, isSel ? C.white : C.muted, FONT_DISPLAY)
    })

    // Bottom power & item count
    label(
      `${sec.district.items.length} OBJ · ${sec.powerGridMw}MW`,
      cx + 7,
      cy + botH - 16,
      8,
      C.dim,
      FONT_PIXEL,
    )

    hits.push({
      id: `sector-card-${idx}`,
      x: cx,
      y: cy,
      w: cardW,
      h: botH,
      onClick: () => state.onSelectSector(selectedSector === idx ? null : idx),
    })
  })

  // ══════════════════════════════════════════════════════════════════════════════
  // 4. RIGHT TACTICAL INSPECTOR PANEL (Sector Objectives & Vek Threat Telegraphs)
  // ══════════════════════════════════════════════════════════════════════════════
  const insW = rightInspectorW
  const insX = W - insW - 14
  const insY = 12
  const insH = H - 22

  const activeSector: SectorInfo | null =
    selectedSector !== null ? board.sectors[selectedSector]! : null

  const accentCol = activeSector ? rgbNorm(activeSector.accentRgb) : C.cyan
  pixelFrame(insX, insY, insW, insH, C.bgPanel, C.borderSteel, accentCol)

  if (activeSector) {
    renderSectorInspector(
      quads,
      insX,
      insY,
      insW,
      insH,
      activeSector,
      board,
      selectedTile ?? hoveredTile,
      blink,
      rect,
      pixelFrame,
      label,
      wrapLines,
      hits,
      state,
    )
  } else {
    renderOverviewInspector(
      insX,
      insY,
      insW,
      insH,
      board,
      hoveredTile,
      blink,
      rect,
      pixelFrame,
      label,
      wrapLines,
      hits,
      state,
    )
  }

  return hits
}

function renderSectorInspector(
  _quads: QuadLayer,
  insX: number,
  insY: number,
  insW: number,
  insH: number,
  sector: SectorInfo,
  board: BreachBoard,
  inspectedCoords: { gx: number; gy: number } | null,
  blink: boolean,
  rect: (x: number, y: number, w: number, h: number, c: RGBA) => void,
  pixelFrame: (x: number, y: number, w: number, h: number, f?: RGBA, b?: RGBA, c?: RGBA) => void,
  label: (
    s: string,
    x: number,
    y: number,
    px: number,
    c?: RGBA,
    f?: string,
    a?: "left" | "center" | "right",
    sh?: boolean,
  ) => { w: number; h: number },
  wrapLines: (s: string, max: number) => string[],
  hits: HudHitRegion[],
  state: HudState,
) {
  const secCol = rgbNorm(sector.accentRgb)
  let y = insY + 8

  // 1. Sector Top Banner
  rect(insX + 8, y, insW - 16, 54, C.bgHeader)
  rect(insX + 8, y, 6, 54, secCol)
  label(`${sector.code} · ${sector.corpName}`, insX + 20, y + 6, 10, secCol, FONT_PIXEL)
  label(sector.district.name.toUpperCase(), insX + 20, y + 20, 18, C.white, FONT_DISPLAY)
  label(
    `ZONE ${sector.index + 1}/7 · ${sector.district.kind.toUpperCase()} SECTOR`,
    insX + 20,
    y + 39,
    9,
    C.muted,
    FONT_PIXEL,
  )

  // [ESC] ALL ZONES button in top-right of inspector
  const escW = 72
  rect(insX + insW - escW - 14, y + 8, escW, 20, C.bgCard)
  label("[ESC] ALL", insX + insW - escW / 2 - 14, y + 12, 9, C.cyan, FONT_PIXEL, "center")
  hits.push({
    id: "btn-inspector-esc",
    x: insX + insW - escW - 14,
    y: y + 8,
    w: escW,
    h: 20,
    onClick: () => state.onSelectSector(null),
  })
  y += 62

  // 2. Tactical Telemetry Stats Row (Terrain Defense Stars, Power Output, Threat Count)
  const statW = Math.floor((insW - 28) / 3)
  const stats = [
    {
      title: "TERRAIN DEF",
      val: `${"★".repeat(sector.defenseStars)} ${sector.defenseStars}/4`,
      col: C.amber,
    },
    {
      title: "GRID OUTPUT",
      val: `+${sector.powerGridMw} MW`,
      col: C.cyan,
    },
    {
      title: "VEK THREATS",
      val: sector.threats.length > 0 ? `! ${sector.threats.length} ACTIVE` : "0 CLEAR",
      col: sector.threats.length > 0 ? C.red : C.green,
    },
  ]
  stats.forEach((st, i) => {
    const sx = insX + 8 + i * (statW + 6)
    rect(sx, y, statW, 38, C.bgCard)
    rect(sx, y, statW, 2, st.col)
    label(st.title, sx + 8, y + 5, 8, C.muted, FONT_PIXEL)
    label(st.val, sx + 8, y + 18, 11, st.col, FONT_PIXEL)
  })
  y += 46

  // 3. Active Tile / Unit Telemetry Box
  const focusTile: BoardTile =
    (inspectedCoords && board.grid[inspectedCoords.gx]?.[inspectedCoords.gy]) ||
    sector.tiles[0]!
  const mechOnTile = board.mechs.find((m) => m.gx === focusTile.gx && m.gy === focusTile.gy)
  const vekOnTile = board.threats.find(
    (v) =>
      (v.fromGx === focusTile.gx && v.fromGy === focusTile.gy) ||
      (v.targetGx === focusTile.gx && v.targetGy === focusTile.gy),
  )

  rect(insX + 8, y, insW - 16, 48, C.bgHeader)
  rect(insX + 8, y, 4, 48, C.cyan)
  label(
    `TILE ${focusTile.coordLabel} · ${focusTile.terrain.toUpperCase()}${focusTile.buildingLabel ? ` · BLDG ${focusTile.buildingLabel}` : ""}`,
    insX + 18,
    y + 6,
    10,
    C.cyan,
    FONT_PIXEL,
  )
  if (mechOnTile) {
    label(
      `UNIT: ${mechOnTile.name} (${mechOnTile.hp}/${mechOnTile.maxHp} HP) · ${mechOnTile.weapon}`,
      insX + 18,
      y + 21,
      10,
      C.green,
      FONT_PIXEL,
    )
    label(`PILOT: ${mechOnTile.pilot}`, insX + 18, y + 34, 8, C.muted, FONT_PIXEL)
  } else if (vekOnTile) {
    label(
      `THREAT: ${vekOnTile.name} (-${vekOnTile.gridDamage} GRID) · DUE ${vekOnTile.when.toUpperCase()}`,
      insX + 18,
      y + 22,
      10,
      C.amber,
      FONT_PIXEL,
    )
  } else {
    label(
      `GRID CAPACITY: ${focusTile.powerBars} BARS · ELEVATION ${focusTile.elevation >= 0 ? "+" : ""}${focusTile.elevation}M`,
      insX + 18,
      y + 23,
      10,
      C.muted,
      FONT_PIXEL,
    )
  }
  y += 56

  // 4. Sector Active Objectives & Vek Threat Telegraphs Header
  rect(insX + 8, y, insW - 16, 22, C.bgCard)
  label("SECTOR OBJECTIVES & VEK TELEGRAPHS", insX + 14, y + 5, 10, C.amber, FONT_PIXEL)
  label(`${sector.district.items.length} ITEMS`, insX + insW - 14, y + 5, 9, C.muted, FONT_PIXEL, "right")
  y += 28

  // 5. Render every item in `sector.district.items`
  const items = sector.district.items
  const availH = insY + insH - y - 54
  const itemGap = 7
  const cardH = Math.min(74, Math.max(54, Math.floor((availH - itemGap * (items.length - 1)) / Math.max(1, items.length))))

  items.forEach((item, idx) => {
    const isUrgent = !!item.urgent
    const linkedThreat = sector.threats.find((t) => t.itemIndex === idx) ?? sector.threats[idx]
    const cardFill: RGBA = isUrgent ? C.redDark : C.bgCard
    const cardBorder: RGBA = isUrgent ? (blink ? C.red : C.amber) : C.borderSteel

    pixelFrame(insX + 8, y, insW - 16, cardH, cardFill, cardBorder, isUrgent ? C.amber : secCol)

    // Top row inside item card: Threat/Objective Tag + Due Date Pill
    const tagStr = isUrgent
      ? `! VEK TELEGRAPH · ${linkedThreat ? linkedThreat.name : "ALPHA VEK"} (-${linkedThreat?.gridDamage ?? 1} GRID)`
      : `OBJECTIVE 0${idx + 1} · ACTIVE`
    label(tagStr, insX + 18, y + 7, 9, isUrgent ? C.amber : C.cyan, FONT_PIXEL)

    if (item.when) {
      const whenStr = `DUE: ${item.when.toUpperCase()}`
      const pillW = whenStr.length * 6.5 + 12
      rect(insX + insW - 16 - pillW, y + 5, pillW, 15, isUrgent ? C.red : C.bgHeader)
      label(
        whenStr,
        insX + insW - 16 - pillW / 2,
        y + 7,
        9,
        C.white,
        FONT_PIXEL,
        "center",
        false,
      )
    }

    // Wrapped item title (never clips!)
    const lines = wrapLines(item.title, 36)
    lines.forEach((ln, li) => {
      label(ln, insX + 18, y + 23 + li * 15, 13, C.white, FONT_DISPLAY)
    })

    if (linkedThreat) {
      hits.push({
        id: `threat-item-${idx}`,
        x: insX + 8,
        y,
        w: insW - 16,
        h: cardH,
        onClick: () => state.onSelectTile(linkedThreat.targetGx, linkedThreat.targetGy),
      })
    }

    y += cardH + itemGap
  })

  // 6. Footer Controls Legend
  const footY = insY + insH - 38
  rect(insX + 8, footY, insW - 16, 30, C.bgHeader)
  label(
    "[1-7] SECTOR   [CLICK] TILE   [ESC] OVERVIEW   [P] PALETTE",
    insX + insW / 2,
    footY + 9,
    9,
    C.muted,
    FONT_PIXEL,
    "center",
  )
}

function renderOverviewInspector(
  insX: number,
  insY: number,
  insW: number,
  insH: number,
  board: BreachBoard,
  hoveredTile: { gx: number; gy: number } | null,
  blink: boolean,
  rect: (x: number, y: number, w: number, h: number, c: RGBA) => void,
  pixelFrame: (x: number, y: number, w: number, h: number, f?: RGBA, b?: RGBA, c?: RGBA) => void,
  label: (
    s: string,
    x: number,
    y: number,
    px: number,
    c?: RGBA,
    f?: string,
    a?: "left" | "center" | "right",
    sh?: boolean,
  ) => { w: number; h: number },
  wrapLines: (s: string, max: number) => string[],
  hits: HudHitRegion[],
  state: HudState,
) {
  let y = insY + 8

  // 1. Island Tactical Overview Header
  rect(insX + 8, y, insW - 16, 52, C.bgHeader)
  rect(insX + 8, y, 6, 52, C.amber)
  label("ISLAND COMMAND · TACTICAL OVERVIEW", insX + 20, y + 6, 10, C.amber, FONT_PIXEL)
  label(`${board.scenario.title.toUpperCase()} TRENCH`, insX + 20, y + 20, 18, C.white, FONT_DISPLAY)
  label(
    `8X8 ISOMETRIC GRID · 7 SECTORS · ${board.threats.length} VEK EMERGING`,
    insX + 20,
    y + 38,
    9,
    C.muted,
    FONT_PIXEL,
  )
  y += 60

  // 2. Hovered Tile Live Readout
  const hTile = hoveredTile ? board.grid[hoveredTile.gx]?.[hoveredTile.gy] : null
  rect(insX + 8, y, insW - 16, 36, C.bgCard)
  rect(insX + 8, y, 4, 36, C.cyan)
  if (hTile) {
    const secName =
      hTile.districtIndex !== null ? board.sectors[hTile.districtIndex]!.district.name : "UNCLAIMED TERRAIN"
    label(
      `CURSOR: TILE ${hTile.coordLabel} · ${hTile.terrain.toUpperCase()} (${secName.toUpperCase()})`,
      insX + 18,
      y + 6,
      9,
      C.cyan,
      FONT_PIXEL,
    )
    label("CLICK TILE OR PRESS [1-7] TO INSPECT SECTOR", insX + 18, y + 20, 9, C.muted, FONT_PIXEL)
  } else {
    label("TACTICAL SCANNER ONLINE · ALL SECTORS VISIBLE", insX + 18, y + 6, 9, C.cyan, FONT_PIXEL)
    label("PRESS [1-7] OR CLICK ANY SECTOR ON THE ISLAND", insX + 18, y + 20, 9, C.muted, FONT_PIXEL)
  }
  y += 44

  // 3. Urgent Vek Attack Telegraphs Queue across all Sectors
  rect(insX + 8, y, insW - 16, 22, C.bgHeader)
  label("IMMINENT VEK THREAT TELEGRAPHS", insX + 14, y + 5, 10, C.red, FONT_PIXEL)
  label(`${board.threats.length} ACTIVE`, insX + insW - 14, y + 5, 9, C.amber, FONT_PIXEL, "right")
  y += 28

  const availH = insY + insH - y - 46
  const count = board.threats.length
  const gap = 6
  const cardH = Math.min(64, Math.max(46, Math.floor((availH - gap * (count - 1)) / Math.max(1, count))))

  board.threats.forEach((th) => {
    const sec = board.sectors[th.districtIndex]!
    const secCol = rgbNorm(sec.accentRgb)
    pixelFrame(
      insX + 8,
      y,
      insW - 16,
      cardH,
      C.redDark,
      blink ? C.red : C.borderSteel,
      secCol,
    )

    const shortSec =
      sec.district.name.length > 18
        ? sec.district.name.slice(0, 17).trim() + "."
        : sec.district.name
    label(
      `[${th.districtIndex + 1}] ${shortSec.toUpperCase()} · ${th.name}`,
      insX + 16,
      y + 5,
      9,
      secCol,
      FONT_PIXEL,
    )

    const dueStr = `DUE ${th.when.toUpperCase()} · -${th.gridDamage} GRID`
    label(dueStr, insX + insW - 16, y + 5, 9, C.amber, FONT_PIXEL, "right")

    const lines = wrapLines(th.title, 37)
    lines.forEach((ln, li) => {
      label(ln, insX + 16, y + 19 + li * 13, 12, C.white, FONT_DISPLAY)
    })

    hits.push({
      id: `overview-threat-${th.id}`,
      x: insX + 8,
      y,
      w: insW - 16,
      h: cardH,
      onClick: () => {
        state.onSelectSector(th.districtIndex)
        state.onSelectTile(th.targetGx, th.targetGy)
      },
    })

    y += cardH + gap
  })

  // 4. Footer Controls Legend
  const footY = insY + insH - 38
  rect(insX + 8, footY, insW - 16, 30, C.bgHeader)
  label(
    "[1-7] FOCUS SECTOR   [CLICK] INSPECT   [P] DAY/NIGHT",
    insX + insW / 2,
    footY + 9,
    9,
    C.muted,
    FONT_PIXEL,
    "center",
  )
}
