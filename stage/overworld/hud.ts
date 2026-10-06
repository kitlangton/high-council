import type { LandmarkNode } from "./landmarks"

export interface HudHitBox {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly run: () => void
}

// Draw a crisp 2px-stepped 16-bit SNES RPG Window Box (Chrono Trigger / SMW style)
function drawSnesBox(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: {
    bgTop?: string
    bgBot?: string
    borderOuter?: string
    borderMid?: string
    borderInner?: string
    goldHighlight?: boolean
    shadow?: boolean
  } = {},
) {
  const ix = Math.round(x)
  const iy = Math.round(y)
  const iw = Math.round(w)
  const ih = Math.round(h)

  if (opts.shadow !== false) {
    ctx.fillStyle = "rgba(4, 10, 24, 0.65)"
    ctx.fillRect(ix + 4, iy + 4, iw, ih)
  }

  // Outer dark obsidian border
  ctx.fillStyle = opts.borderOuter ?? "#060d1f"
  ctx.fillRect(ix, iy, iw, ih)

  // Golden/Bronze outer frame
  ctx.fillStyle = opts.borderMid ?? (opts.goldHighlight ? "#fef08a" : "#d97706")
  ctx.fillRect(ix + 2, iy + 2, iw - 4, ih - 4)

  // Bright gold top/left bevel
  ctx.fillStyle = opts.goldHighlight ? "#ffffff" : "#fbbf24"
  ctx.fillRect(ix + 2, iy + 2, iw - 6, 2)
  ctx.fillRect(ix + 2, iy + 2, 2, ih - 6)

  // Inner dark groove
  ctx.fillStyle = opts.borderInner ?? "#09132b"
  ctx.fillRect(ix + 5, iy + 5, iw - 10, ih - 10)

  // Classic Chrono Trigger / FF6 vertical navy gradient interior
  const grad = ctx.createLinearGradient(0, iy + 7, 0, iy + ih - 7)
  grad.addColorStop(0, opts.bgTop ?? "#17326e")
  grad.addColorStop(1, opts.bgBot ?? "#0b1738")
  ctx.fillStyle = grad
  ctx.fillRect(ix + 7, iy + 7, iw - 14, ih - 14)

  // Corner pixel rivets
  const rivetCol = opts.goldHighlight ? "#fef08a" : "#fde047"
  ctx.fillStyle = rivetCol
  ctx.fillRect(ix + 3, iy + 3, 3, 3)
  ctx.fillRect(ix + iw - 6, iy + 3, 3, 3)
  ctx.fillRect(ix + 3, iy + ih - 6, 3, 3)
  ctx.fillRect(ix + iw - 6, iy + ih - 6, 3, 3)
}

function drawPixelText(
  ctx: OffscreenCanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  font: string,
  color: string,
  align: CanvasTextAlign = "left",
  shadowOffset = 2,
) {
  ctx.font = font
  ctx.textAlign = align
  ctx.textBaseline = "middle"
  const ix = Math.round(x)
  const iy = Math.round(y)
  if (shadowOffset > 0) {
    ctx.fillStyle = "#050b1a"
    ctx.fillText(str, ix + shadowOffset, iy + shadowOffset)
  }
  ctx.fillStyle = color
  ctx.fillText(str, ix, iy)
}

// Draw a 32x32 pixel-art emblem inside the Quest Scroll header
function drawLandmarkEmblem(
  ctx: OffscreenCanvasRenderingContext2D,
  emblem: LandmarkNode["emblem"],
  x: number,
  y: number,
  size: number,
) {
  const ix = Math.round(x)
  const iy = Math.round(y)
  // Emblem frame
  ctx.fillStyle = "#060d1f"
  ctx.fillRect(ix, iy, size, size)
  ctx.fillStyle = "#fbbf24"
  ctx.fillRect(ix + 2, iy + 2, size - 4, size - 4)
  ctx.fillStyle = "#1e3a8a"
  ctx.fillRect(ix + 4, iy + 4, size - 8, size - 8)

  const p = (gx: number, gy: number, gw: number, gh: number, col: string) => {
    ctx.fillStyle = col
    ctx.fillRect(ix + gx * 2, iy + gy * 2, gw * 2, gh * 2)
  }

  if (emblem === "keep") {
    p(6, 4, 12, 4, "#2563eb")
    p(8, 2, 8, 3, "#60a5fa")
    p(5, 8, 14, 11, "#cbd5e1")
    p(4, 6, 4, 13, "#94a3b8")
    p(16, 6, 4, 13, "#94a3b8")
    p(10, 13, 4, 6, "#0f172a")
    p(11, 9, 2, 3, "#fef08a")
  } else if (emblem === "windmill") {
    p(5, 11, 14, 8, "#fef3c7")
    p(3, 6, 18, 6, "#ef4444")
    p(6, 4, 12, 3, "#f87171")
    p(6, 7, 3, 3, "#ffffff")
    p(15, 7, 3, 3, "#ffffff")
    p(10, 14, 4, 5, "#78350f")
  } else if (emblem === "foundry") {
    p(4, 16, 16, 4, "#f97316")
    p(6, 17, 12, 2, "#fef08a")
    p(5, 8, 14, 9, "#475569")
    p(7, 3, 3, 6, "#334155")
    p(14, 3, 3, 6, "#334155")
    p(9, 11, 6, 6, "#dc2626")
    p(10, 12, 4, 4, "#fef08a")
  } else if (emblem === "star") {
    p(10, 3, 4, 4, "#fef08a")
    p(4, 8, 16, 4, "#fbbf24")
    p(7, 12, 10, 4, "#fbbf24")
    p(5, 16, 5, 4, "#d97706")
    p(14, 16, 5, 4, "#d97706")
    p(10, 9, 1, 2, "#0f172a")
    p(13, 9, 1, 2, "#0f172a")
  } else if (emblem === "cottage") {
    p(5, 10, 14, 9, "#fef3c7")
    p(3, 6, 18, 5, "#dc2626")
    p(6, 4, 12, 3, "#ef4444")
    p(8, 13, 4, 6, "#92400e")
    p(14, 12, 4, 4, "#fde047")
  } else if (emblem === "fair") {
    p(4, 10, 16, 9, "#ef4444")
    p(7, 10, 3, 9, "#ffffff")
    p(14, 10, 3, 9, "#ffffff")
    p(6, 6, 12, 4, "#fbbf24")
    p(10, 3, 4, 3, "#ec4899")
  } else {
    // Ghost ship / Boo
    p(6, 5, 12, 12, "#ffffff")
    p(4, 14, 16, 4, "#cbd5e1")
    p(8, 8, 2, 3, "#0f172a")
    p(14, 8, 2, 3, "#0f172a")
    p(10, 12, 4, 2, "#f43f5e")
  }
}

export function renderOverworldHud(
  ctx: OffscreenCanvasRenderingContext2D,
  W: number,
  H: number,
  landmarks: ReadonlyArray<LandmarkNode>,
  focus: number,
  hover: number,
  heroNode: number,
  heroWalking: boolean,
  crtOn: boolean,
  cardOpen: number,
  time: number,
  worldToScreen: (wx: number, wy: number) => [number, number],
  actions: {
    select: (idx: number) => void
    back: () => void
    toggleCrt: () => void
  },
): HudHitBox[] {
  const hits: HudHitBox[] = []
  ctx.clearRect(0, 0, W, H)
  ctx.imageSmoothingEnabled = false

  // ── 1. On-Map Landmark Nameplates (clickable pixel tags) ──────────────────
  for (const lm of landmarks) {
    const [sx, sy] = worldToScreen(lm.x, lm.y + lm.labelOffset[1])
    const isFocused = focus === lm.index
    const isHovered = hover === lm.index
    const dim = focus >= 0 && !isFocused

    // Skip off-screen labels or labels hidden behind the right quest scroll when open
    if (sx < 40 || sx > W - (cardOpen > 0.3 ? 440 : 40) || sy < 56 || sy > H - 62) continue

    const urgent = lm.district.urgent
    const tagTitle = lm.overworldTitle.toUpperCase()
    ctx.font = "700 11px 'Silkscreen', monospace"
    const textW = Math.ceil(ctx.measureText(tagTitle).width)
    const badgeW = urgent > 0 ? 30 : 18
    const boxW = 24 + textW + badgeW + 12
    const boxH = 24
    const bx = Math.round(sx - boxW / 2)
    const by = Math.round(sy - boxH / 2 + (isFocused ? Math.sin(time * 6) * 2 : 0))

    ctx.save()
    ctx.globalAlpha = dim ? 0.68 : 1

    // Outer border & background
    ctx.fillStyle = "#050b1a"
    ctx.fillRect(bx + 2, by + 2, boxW, boxH)
    ctx.fillStyle = isFocused || isHovered ? "#fef08a" : "#fbbf24"
    ctx.fillRect(bx, by, boxW, boxH)
    ctx.fillStyle = isFocused ? "#1e3a8a" : "#0f1e45"
    ctx.fillRect(bx + 2, by + 2, boxW - 4, boxH - 4)

    // Stage number badge on left (`1`..`7`)
    ctx.fillStyle = lm.accent
    ctx.fillRect(bx + 4, by + 4, 16, boxH - 8)
    drawPixelText(ctx, String(lm.index + 1), bx + 12, by + boxH / 2 + 1, "700 11px 'Silkscreen', monospace", "#ffffff", "center", 1)

    // Landmark Name
    drawPixelText(
      ctx,
      tagTitle,
      bx + 25,
      by + boxH / 2 + 1,
      "700 11px 'Silkscreen', monospace",
      isFocused ? "#fef08a" : "#f8fafc",
      "left",
      1,
    )

    // Urgent Boss Badge (`!3`) or Clear Star (`★`)
    const rx = bx + boxW - badgeW - 4
    if (urgent > 0) {
      const pulse = Math.floor(time * 6) % 2 === 0
      ctx.fillStyle = pulse ? "#ef4444" : "#b91c1c"
      ctx.fillRect(rx, by + 4, badgeW, boxH - 8)
      drawPixelText(ctx, `!${urgent}`, rx + badgeW / 2, by + boxH / 2 + 1, "700 11px 'Silkscreen', monospace", "#fef08a", "center", 1)
    } else {
      ctx.fillStyle = "#1d4ed8"
      ctx.fillRect(rx, by + 4, badgeW, boxH - 8)
      drawPixelText(ctx, "★", rx + badgeW / 2, by + boxH / 2, "700 11px 'PixelifySans', monospace", "#fde047", "center", 1)
    }

    // Little pointer stem toward the landmark
    const stemY = lm.labelOffset[1] < 0 ? by + boxH : by - 5
    ctx.fillStyle = "#050b1a"
    ctx.fillRect(Math.round(sx) - 3, stemY, 6, 5)
    ctx.fillStyle = isFocused || isHovered ? "#fef08a" : "#fbbf24"
    ctx.fillRect(Math.round(sx) - 2, stemY + 1, 4, 3)

    ctx.restore()

    hits.push({
      x: bx,
      y: by,
      w: boxW,
      h: boxH,
      run: () => actions.select(lm.index),
    })
  }

  // ── 2. Top SNES Overworld Banner ───────────────────────────────────────────
  const topH = 48
  drawSnesBox(ctx, 12, 8, W - 24, topH, { shadow: true })

  // Region Title: ★ HIGH COUNCIL OVERWORLD ★
  drawPixelText(
    ctx,
    "★ HIGH COUNCIL OVERWORLD ★",
    28,
    8 + topH / 2,
    "700 20px 'PixelifySans', monospace",
    "#fef08a",
    "left",
    2,
  )

  // Total Quests & Urgent Boss Stages summary
  const totalQuests = landmarks.reduce((acc, l) => acc + l.district.items.length, 0)
  const totalUrgent = landmarks.reduce((acc, l) => acc + l.district.urgent, 0)
  const activeLm = landmarks[focus >= 0 ? focus : heroNode]!

  const statX = 330
  // Quests pill
  ctx.fillStyle = "#091533"
  ctx.fillRect(statX, 18, 134, 28)
  ctx.fillStyle = "#38bdf8"
  ctx.fillRect(statX, 18, 4, 28)
  drawPixelText(ctx, `★ ${totalQuests} QUESTS`, statX + 14, 33, "700 12px 'Silkscreen', monospace", "#e0f2fe", "left", 1)

  // Urgent Boss Stages pill
  const bossX = statX + 146
  ctx.fillStyle = "#2a0a12"
  ctx.fillRect(bossX, 18, 148, 28)
  ctx.fillStyle = "#ef4444"
  ctx.fillRect(bossX, 18, 4, 28)
  drawPixelText(ctx, `! ${totalUrgent} BOSS DUE`, bossX + 14, 33, "700 12px 'Silkscreen', monospace", "#fca5a5", "left", 1)

  // Hero Traveler location / status
  const heroX = bossX + 160
  const heroStatus = heroWalking
    ? `TRAVELING → ${activeLm.overworldTitle.toUpperCase()}`
    : `${activeLm.stageCode} · ${activeLm.overworldTitle.toUpperCase()}`
  drawPixelText(
    ctx,
    heroStatus,
    heroX,
    33,
    "700 13px 'Silkscreen', monospace",
    heroWalking ? "#fde047" : "#86efac",
    "left",
    2,
  )

  // Right side CRT Toggle & Map Overview Button
  const crtBtnW = 118
  const crtBtnX = W - 24 - crtBtnW
  ctx.fillStyle = crtOn ? "#15803d" : "#1e293b"
  ctx.fillRect(crtBtnX, 18, crtBtnW, 28)
  ctx.fillStyle = "#fbbf24"
  ctx.fillRect(crtBtnX, 18, crtBtnW, 2)
  ctx.fillRect(crtBtnX, 44, crtBtnW, 2)
  drawPixelText(
    ctx,
    crtOn ? "[P] CRT: ON" : "[P] CRT: OFF",
    crtBtnX + crtBtnW / 2,
    33,
    "700 11px 'Silkscreen', monospace",
    "#ffffff",
    "center",
    1,
  )
  hits.push({ x: crtBtnX, y: 18, w: crtBtnW, h: 28, run: actions.toggleCrt })

  if (focus >= 0) {
    const mapBtnW = 128
    const mapBtnX = crtBtnX - mapBtnW - 10
    ctx.fillStyle = "#1e3a8a"
    ctx.fillRect(mapBtnX, 18, mapBtnW, 28)
    ctx.fillStyle = "#fbbf24"
    ctx.fillRect(mapBtnX, 18, mapBtnW, 2)
    ctx.fillRect(mapBtnX, 44, mapBtnW, 2)
    drawPixelText(ctx, "[ESC] MAP", mapBtnX + mapBtnW / 2, 33, "700 11px 'Silkscreen', monospace", "#fef08a", "center", 1)
    hits.push({ x: mapBtnX, y: 18, w: mapBtnW, h: 28, run: actions.back })
  }

  // ── 3. Right Quest Scroll / Stage Select Box (when a landmark is focused) ──
  if (cardOpen > 0.02 && focus >= 0) {
    const lm = landmarks[focus]!
    const d = lm.district
    const cardW = 416
    const items = d.items
    const cardH = 152 + items.length * 58 + 26
    const slideX = Math.round((1 - cardOpen) * (cardW + 30))
    const cx = W - cardW - 16 + slideX
    const cy = Math.max(68, Math.round((H - cardH) / 2 - 8))

    drawSnesBox(ctx, cx, cy, cardW, cardH, {
      bgTop: "#152c66",
      bgBot: "#091330",
      goldHighlight: true,
      shadow: true,
    })

    // Emblem + Header
    drawLandmarkEmblem(ctx, lm.emblem, cx + 18, cy + 18, 48)

    // Stage badge + Overworld Landmark Title
    ctx.fillStyle = lm.accent
    ctx.fillRect(cx + 76, cy + 18, 96, 18)
    drawPixelText(ctx, lm.stageCode, cx + 124, cy + 28, "700 11px 'Silkscreen', monospace", "#ffffff", "center", 1)

    if (d.urgent > 0) {
      ctx.fillStyle = "#dc2626"
      ctx.fillRect(cx + 178, cy + 18, 118, 18)
      drawPixelText(
        ctx,
        `! ${d.urgent} BOSS STAGE${d.urgent > 1 ? "S" : ""}`,
        cx + 237,
        cy + 28,
        "700 10px 'Silkscreen', monospace",
        "#fef08a",
        "center",
        1,
      )
    }

    drawPixelText(
      ctx,
      lm.overworldTitle.toUpperCase(),
      cx + 76,
      cy + 50,
      "700 22px 'PixelifySans', monospace",
      "#fef08a",
      "left",
      2,
    )
    drawPixelText(
      ctx,
      lm.subtitle,
      cx + 76,
      cy + 70,
      "600 14px 'PixelifySans', monospace",
      "#93c5fd",
      "left",
      1,
    )

    // Close [X] button
    const closeX = cx + cardW - 42
    const closeY = cy + 16
    ctx.fillStyle = "#991b1b"
    ctx.fillRect(closeX, closeY, 26, 22)
    ctx.fillStyle = "#fca5a5"
    ctx.fillRect(closeX, closeY, 26, 2)
    drawPixelText(ctx, "X", closeX + 13, closeY + 12, "700 12px 'Silkscreen', monospace", "#ffffff", "center", 1)
    hits.push({ x: closeX, y: closeY, w: 26, h: 22, run: actions.back })

    // Activity & Staleness RPG Stat Bar
    const barY = cy + 88
    ctx.fillStyle = "#070f26"
    ctx.fillRect(cx + 18, barY, cardW - 36, 26)
    ctx.fillStyle = "#1e3a8a"
    ctx.fillRect(cx + 18, barY, cardW - 36, 2)

    drawPixelText(ctx, "ACTIVITY", cx + 28, barY + 14, "700 10px 'Silkscreen', monospace", "#93c5fd", "left", 1)
    // Meter blocks
    const meterX = cx + 108
    const blocks = 10
    const activeBlocks = Math.round(d.activity * blocks)
    for (let b = 0; b < blocks; b++) {
      ctx.fillStyle = b < activeBlocks ? "#4ade80" : "#1e293b"
      ctx.fillRect(meterX + b * 11, barY + 7, 8, 12)
    }

    const statusLabel =
      d.stale >= 0.5
        ? `HAUNTED · ${Math.round(d.stale * 100)}% STALE`
        : d.urgent > 0
          ? `${d.items.length} QUESTS · ${d.urgent} URGENT`
          : `${d.items.length} QUESTS · CLEAR`
    drawPixelText(
      ctx,
      statusLabel,
      cx + cardW - 26,
      barY + 14,
      "700 10px 'Silkscreen', monospace",
      d.urgent > 0 ? "#fca5a5" : "#fde047",
      "right",
      1,
    )

    // Section Header: QUEST LOG / STAGES
    drawPixelText(
      ctx,
      "▼ ACTIVE QUEST STAGES",
      cx + 20,
      cy + 132,
      "700 12px 'Silkscreen', monospace",
      "#fbbf24",
      "left",
      1,
    )

    // Quest Stage Cards
    items.forEach((it, idx) => {
      const ry = cy + 148 + idx * 58
      const rh = 50
      const rx = cx + 18
      const rw = cardW - 36

      // Parchment / Dark RPG Stage slot
      ctx.fillStyle = "#050b1c"
      ctx.fillRect(rx + 2, ry + 2, rw, rh)
      ctx.fillStyle = it.urgent ? "#ef4444" : "#3b82f6"
      ctx.fillRect(rx, ry, rw, rh)
      ctx.fillStyle = it.urgent ? "#281024" : "#10224d"
      ctx.fillRect(rx + 2, ry + 2, rw - 4, rh - 4)

      // Left Stage Type Badge (! BOSS vs ★ STAGE)
      const badgeX = rx + 8
      const badgeY = ry + 8
      if (it.urgent) {
        ctx.fillStyle = "#dc2626"
        ctx.fillRect(badgeX, badgeY, 64, 18)
        drawPixelText(ctx, "! BOSS", badgeX + 32, badgeY + 10, "700 10px 'Silkscreen', monospace", "#fef08a", "center", 1)
      } else {
        ctx.fillStyle = "#1d4ed8"
        ctx.fillRect(badgeX, badgeY, 64, 18)
        drawPixelText(ctx, `STAGE ${idx + 1}`, badgeX + 32, badgeY + 10, "700 10px 'Silkscreen', monospace", "#bae6fd", "center", 1)
      }

      // Due Date (`when`) Pill on Top Right of the quest card
      if (it.when) {
        const dueStr = `DUE: ${it.when.toUpperCase()}`
        ctx.font = "700 10px 'Silkscreen', monospace"
        const dw = Math.ceil(ctx.measureText(dueStr).width) + 16
        const dx = rx + rw - dw - 8
        ctx.fillStyle = it.urgent ? "#f59e0b" : "#334155"
        ctx.fillRect(dx, badgeY, dw, 18)
        drawPixelText(
          ctx,
          dueStr,
          dx + dw / 2,
          badgeY + 10,
          "700 10px 'Silkscreen', monospace",
          it.urgent ? "#050b1a" : "#e2e8f0",
          "center",
          0,
        )
      }

      // Quest Title below the badges (plenty of horizontal breathing room!)
      const titleStr = it.title.length > 44 ? it.title.slice(0, 43) + "…" : it.title
      drawPixelText(
        ctx,
        titleStr,
        rx + 10,
        ry + 37,
        "600 16px 'PixelifySans', monospace",
        "#ffffff",
        "left",
        2,
      )
    })

    // Footer hint inside Quest Scroll
    drawPixelText(
      ctx,
      "PRESS [1-7] TO TRAVEL  ·  [ESC] WORLD MAP",
      cx + cardW / 2,
      cy + cardH - 16,
      "700 10px 'Silkscreen', monospace",
      "#93c5fd",
      "center",
      1,
    )
  }

  // ── 4. Bottom Node Bar (Quick-jump buttons 1-7 + Key Legend) ───────────────
  const botH = 48
  const botY = H - botH - 8
  drawSnesBox(ctx, 12, botY, W - 24, botH, { shadow: true })

  let bx = 22
  const btnH = 30
  const btnY = botY + 9
  const shortNames = ["KEEP", "VILLAGE", "FOUNDRY", "STAR ROAD", "HOMESTEAD", "FAIR", "GHOST SHIP"]

  landmarks.forEach((lm, i) => {
    const label = `${i + 1}:${shortNames[i]}`
    ctx.font = "700 11px 'Silkscreen', monospace"
    const tw = Math.ceil(ctx.measureText(label).width)
    const urgent = lm.district.urgent
    const bw = tw + (urgent > 0 ? 32 : 16)
    const isSel = focus === i
    const isHero = heroNode === i && focus < 0

    ctx.fillStyle = isSel ? "#fef08a" : isHero ? "#38bdf8" : "#334155"
    ctx.fillRect(bx, btnY, bw, btnH)
    ctx.fillStyle = isSel ? "#1e3a8a" : "#0b1736"
    ctx.fillRect(bx + 2, btnY + 2, bw - 4, btnH - 4)

    drawPixelText(
      ctx,
      label,
      bx + 8,
      btnY + btnH / 2 + 1,
      "700 11px 'Silkscreen', monospace",
      isSel ? "#fef08a" : "#e2e8f0",
      "left",
      1,
    )

    if (urgent > 0) {
      ctx.fillStyle = "#dc2626"
      ctx.fillRect(bx + bw - 22, btnY + 5, 17, btnH - 10)
      drawPixelText(
        ctx,
        `!${urgent}`,
        bx + bw - 13,
        btnY + btnH / 2 + 1,
        "700 10px 'Silkscreen', monospace",
        "#fef08a",
        "center",
        1,
      )
    }

    hits.push({ x: bx, y: btnY, w: bw, h: btnH, run: () => actions.select(i) })
    bx += bw + 7
  })

  // Key Legend on Right side of Bottom Bar
  if (W - bx > 240) {
    drawPixelText(
      ctx,
      "[1-7] TRAVEL   [ESC] WORLD MAP   [P] CRT MODE",
      W - 28,
      botY + botH / 2 + 1,
      "700 11px 'Silkscreen', monospace",
      "#fde047",
      "right",
      1,
    )
  }

  return hits
}
