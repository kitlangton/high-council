import type { Briefing, Transmission } from "../../src/briefing/model"
import { Camera } from "../core/camera"
import { Kind, type Quad, type Renderer } from "../core/gpu"
import { clamp, lerp, Spring } from "../core/motion"
import { ClipPlayer, Radio } from "../core/voice"
import type { CodecInput } from "./codec"

// 1996 Civilization II CD-ROM Edition WebGPU Briefing Skin:
// 4:3 320x240 Bayer-dithered Cinepak FMV portraits in sunken stone-bevelled monitors,
// chunky Windows 95 / MicroProse 3D bevels, parchment speech scrolls, and 9 fps stepped acting.

type RGB = [number, number, number]
const STONE_PANEL: RGB = [0.22, 0.19, 0.16]
const STONE_DARK: RGB = [0.09, 0.08, 0.06]
const STONE_HI: RGB = [0.46, 0.41, 0.34]
const STONE_LO: RGB = [0.06, 0.05, 0.04]
const WIN_FACE: RGB = [0.72, 0.7, 0.65]
const WIN_HI: RGB = [0.96, 0.94, 0.89]
const WIN_SHADOW: RGB = [0.28, 0.26, 0.22]
const PARCHMENT: RGB = [0.9, 0.86, 0.72]
const PARCHMENT_HI: RGB = [1.0, 0.97, 0.88]
const PARCHMENT_LO: RGB = [0.42, 0.36, 0.24]
const INK: RGB = [0.08, 0.06, 0.03]
const GOLD: RGB = [1.0, 0.8, 0.2]
const MAROON: RGB = [0.5, 0.06, 0.06]
const GREEN_CRT: RGB = [0.2, 0.98, 0.42]
const RED_ANARCHY: RGB = [0.9, 0.15, 0.15]
const rgba = (c: RGB, a = 1): [number, number, number, number] => [c[0], c[1], c[2], a]

const SERIF = (w: number) => `${w} {px} 'Times New Roman', 'Georgia', serif`
const SANS95 = (w: number) => `${w} {px} 'Tahoma', 'Geneva', 'Verdana', sans-serif`
const MONO = (w: number) => `${w} {px} 'Courier New', ui-monospace, monospace`

interface Type { px: number; font: string; spacing: number; caps: boolean }
const T = {
  caption: { px: 13, font: MONO(700), spacing: 0.8, caps: true },
  btn: { px: 16, font: SANS95(700), spacing: 0.3, caps: false },
  small: { px: 18, font: SERIF(700), spacing: 0.1, caps: false },
  label: { px: 21, font: SERIF(700), spacing: 0.5, caps: true },
  body: { px: 28, font: SERIF(700), spacing: 0.1, caps: false },
  title: { px: 25, font: SERIF(700), spacing: 0.6, caps: true },
  banner: { px: 54, font: SERIF(700), spacing: 0.6, caps: true },
} satisfies Record<string, Type>

const COURT_TITLES: Record<string, { title: string; dept: string }> = {
  chief: { title: "DOMESTIC ADVISOR", dept: "MINISTRY OF THE INTERIOR" },
  strategist: { title: "MILITARY ADVISOR", dept: "WAR & DEFENSE COUNCIL" },
  quartermaster: { title: "TRADE ADVISOR", dept: "TREASURY & SUPPLY" },
  liaison: { title: "FOREIGN ADVISOR", dept: "EMBASSIES & ENVOYS" },
}

const PANEL = { w: 1600, h: 1000 }
const M = 48
// 4:3 FMV video monitor dimensions (480x360 = 1.5x of 320x240 native Cinepak)
const MON_W = 480
const MON_H = 360
const PITCH = 1760
const FAR_ZOOM = 0.42
const LH = 42

const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3)
const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, "")
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches

interface Word { text: string; x: number; line: number }
interface Item { label: string; detail: string[]; when: string; y: number; h: number; at: number }

interface Station {
  t: Transmission
  i: number
  x: number
  player: ClipPlayer | null
  open: Spring
  live: Spring
  lift: Spring
  scroll: Spring
  fill: Spring
  connectedAt: number
  verdict: "approved" | "dismissed" | null
  words: Word[]
  items: Item[]
  headline: string[]
  banner: string[]
}

export function cabinet(r: Renderer, briefing: Briefing, layers: Map<string, [number, number]>) {
  const cam = new Camera()
  const radio = new Radio()
  const burst = new Spring(0, 8, 1)
  let focus = -1
  let connected = -1
  let hovered = -1
  let time = 0
  let ringing = -1
  let epoch = 0
  const timers: { at: number; run: () => void; tag: number }[] = []
  const later = (s: number, run: () => void) => timers.push({ at: time + s, run, tag: epoch })
  const buttons: { x: number; y: number; w: number; h: number; run: () => void }[] = []

  // Crisp 90s CD-ROM CRT scanline post pass, no soft oil bloom
  r.post.scan = 0.38
  r.post.grain = 0.025
  r.post.bloom = 0.18
  r.post.tint = [0.95, 0.85, 0.65]

  const measure = (str: string, ty: Type) => r.text(ty.caps ? str.toUpperCase() : str, ty.px, ty.font, ty.spacing)
  const wrap = (str: string, ty: Type, max: number) => {
    const out: string[] = []
    let line = ""
    for (const word of str.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word
      if (line && measure(next, ty).w > max) { out.push(line); line = word } else line = next
    }
    if (line) out.push(line)
    return out
  }

  const RIGHT_W = PANEL.w - 2 * M - MON_W - 44

  const stations: Station[] = briefing.transmissions.map((t, i) => {
    const clipWords = t.clip?.words ?? []
    const source = clipWords.length ? clipWords.map((w) => w.word) : t.script.split(/\s+/)
    const words: Word[] = []
    const space = measure(" ", T.body).w * 0.58
    let x = 0, line = 0
    for (const text of source) {
      const w = measure(text, T.body).w
      if (x > 0 && x + w > PANEL.w - 2 * M - 64) { x = 0; line++ }
      words.push({ text, x, line })
      x += w + space
    }

    const spoken = clipWords.map((w) => norm(w.word))
    const duration = t.clip?.duration ?? 1
    let y = 0
    let cursor = 0
    const items: Item[] = []
    t.dossier.forEach((d, k) => {
      const detail = wrap(d.detail, T.small, RIGHT_W - 48)
      const h = 34 + detail.length * 24 + 10
      if (y + h > 410) return
      const keys = d.label.split(/\s+/).map(norm).filter((w) => w.length >= 4)
      const off = spoken.slice(cursor).findIndex((w) => keys.includes(w))
      const hit = off >= 0 ? cursor + off : -1
      if (hit >= 0) cursor = hit + 1
      const at = hit >= 0 ? clipWords[hit]!.s : (k / t.dossier.length) * duration * 0.85
      const when = d.when ?? ""
      items.push({ label: d.label, detail, when, y, h, at })
      y += h + 10
    })

    return {
      t, i, x: i * PITCH, words, items,
      headline: wrap(t.headline, T.label, RIGHT_W).slice(0, 2),
      banner: wrap(t.headline, T.banner, PANEL.w - 2 * M - 24).slice(0, 3),
      player: t.clip ? new ClipPlayer(t.clip) : null,
      open: new Spring(1, 14, 0.7),
      live: new Spring(0, 7, 1),
      lift: new Spring(1, 20, 0.7),
      scroll: new Spring(0, 9, 1),
      fill: new Spring(0, 14, 0.8),
      connectedAt: -10, verdict: null,
    }
  })

  const overview = (snap = false) => {
    const w = stations.length * PITCH - (PITCH - PANEL.w)
    cam.frame(w / 2, PANEL.h / 2 + 110, w + 160, PANEL.h + 460, snap || reduced)
  }
  const frameStation = (i: number, snap = false) =>
    cam.frame(stations[i]!.x + PANEL.w / 2, PANEL.h / 2, PANEL.w + 110, PANEL.h + 70, snap || reduced)

  function hangup() {
    const s = stations[connected]
    if (s) { s.player?.pause(); s.live.set(0) }
    connected = -1
  }

  function tune(i: number) {
    if (i < 0 || i >= stations.length) return
    epoch++
    timers.length = 0
    const from = focus
    if (connected !== i) hangup()
    focus = i
    radio.tick()
    if (from !== -1 && from !== i && !reduced) {
      const mid = (stations[from]!.x + stations[i]!.x) / 2 + PANEL.w / 2
      cam.x.set(mid)
      cam.logZoom.set(Math.log(Math.min(cam.w / (Math.abs(stations[i]!.x - stations[from]!.x) + PANEL.w * 1.6), cam.h / (PANEL.h * 1.8))))
      later(0.26, () => frameStation(i))
    } else frameStation(i)
    const s = stations[i]!
    if (connected === i) return
    ringing = i
    later(0.35, () => {
      ringing = -1
      connected = i
      s.connectedAt = time
      s.live.set(1)
      later(0.2, () => { if (s.player?.ended) s.player.stop(); void s.player?.play() })
    })
  }

  function back() {
    epoch++
    timers.length = 0
    ringing = -1
    hangup()
    focus = -1
    overview()
    radio.tick()
  }

  function decide(s: Station, verdict: "approved" | "dismissed") {
    s.verdict = s.verdict === verdict ? null : verdict
    s.fill.snap(0).set(s.verdict ? 1 : 0)
    radio.tick()
  }

  let z = 1
  let blur: [number, number] = [0, 0]
  let xf = { cx: 0, cy: 0, k: 1 }
  const S = (wx: number, wy: number) => cam.toScreen(xf.cx + (wx - xf.cx) * xf.k, xf.cy + (wy - xf.cy) * xf.k)
  const zk = () => z * xf.k

  function rect(wx: number, wy: number, ww: number, wh: number, o: Partial<Quad>) {
    const [x, y] = S(wx, wy)
    const k = zk()
    r.push({ x, y, w: ww * k, h: wh * k, ...o, radius: 0, stroke: o.stroke ? Math.max(1, o.stroke * k) : 0 })
  }

  // Chunky Windows 95 / MicroProse 3D raised or sunken bevel box
  function bevelBox(wx: number, wy: number, ww: number, wh: number, face: RGB, hi: RGB, lo: RGB, sunken = false, borderPx = 4) {
    const topCol = sunken ? lo : hi
    const botCol = sunken ? hi : lo
    rect(wx - 2, wy - 2, ww + 4, wh + 4, { color: rgba(STONE_LO, 1) })
    rect(wx, wy, ww, wh, { color: rgba(face, 1) })
    rect(wx, wy, ww, borderPx, { color: rgba(topCol, 1) })
    rect(wx, wy, borderPx, wh, { color: rgba(topCol, 1) })
    rect(wx, wy + wh - borderPx, ww, borderPx, { color: rgba(botCol, 1) })
    rect(wx + ww - borderPx, wy, borderPx, wh, { color: rgba(botCol, 1) })
  }

  function text(str: string, ty: Type, wx: number, wy: number, color: RGB, alpha = 1, align: "left" | "center" | "right" = "left") {
    if (!str || alpha <= 0.003) return
    const s = ty.caps ? str.toUpperCase() : str
    const e = r.text(s, ty.px, ty.font, ty.spacing)
    const ox = align === "center" ? -e.w / 2 : align === "right" ? -e.w : 0
    const [x, y] = S(wx + ox, wy - e.h / 2)
    const k = zk()
    if (x > cam.w + 50 || y > cam.h + 50 || x + e.w * k < -50 || y + e.h * k < -50) return
    r.push({ kind: Kind.text, x, y, w: e.w * k, h: e.h * k, uv: e.uv, color: rgba(color), alpha })
  }

  function drawStation(s: Station, dt: number) {
    const ox = s.x, oy = 0
    xf = { cx: ox + PANEL.w / 2, cy: oy + PANEL.h / 2, k: s.lift.set(hovered === s.i && focus === -1 ? 1.02 : 1).step(dt) }
    const [sx0] = S(ox, oy)
    if (sx0 > cam.w + 40 || sx0 + PANEL.w * zk() < -40) return

    const isConn = connected === s.i
    s.live.step(dt)
    s.open.step(dt)
    s.fill.step(dt)
    const p = s.player
    const t = p?.time ?? 0
    const dur = p?.clip.duration ?? 1
    const talking = isConn && !!p?.playing
    // Stepped ~9 fps (110ms) choppy 1996 CD-ROM FMV mouth & head bob!
    const tick9 = Math.floor(t * 9)
    const mouth = talking && p!.mouthOpen(tick9 / 9) ? 1 : 0
    const bobX = talking ? [0, 2, 0, -2, 0, 3][tick9 % 6]! : 0
    const bobY = talking ? [0, -3, -4, 0, 2, 0][tick9 % 6]! : (Math.floor(time * 0.8 + s.i) % 2) * -1
    const urgent = s.t.priority === "urgent"
    const far = clamp((FAR_ZOOM - z) / 0.14, 0, 1)
    const near = 1 - far
    const court = COURT_TITLES[s.t.caller.id] ?? { title: s.t.caller.role, dept: "HIGH COUNCIL" }

    // Outer MicroProse Stone Bevel Window
    bevelBox(ox, oy, PANEL.w, PANEL.h, STONE_PANEL, isConn ? GOLD : STONE_HI, STONE_LO, false, 6)

    // Classic Civ II Gold-and-Maroon Titlebar
    bevelBox(ox + 16, oy + 16, PANEL.w - 32, 48, MAROON, GOLD, STONE_LO, false, 3)
    text(`HIGH COUNCIL — ${court.dept}`, T.label, ox + 34, oy + 40, GOLD, near)
    rect(ox + PANEL.w - 280, oy + 24, 246, 32, { color: [0, 0, 0, 0.95] })
    text(`320x240 CINEPAK · 9 FPS`, T.caption, ox + PANEL.w - 157, oy + 40, GREEN_CRT, near, "center")

    // ── Left Column: Sunken 4:3 (480x360) CD-ROM FMV Video Well ──
    const px = ox + M
    const py = oy + 88
    bevelBox(px - 6, py - 6, MON_W + 12, MON_H + 12, STONE_DARK, STONE_HI, STONE_LO, true, 5)

    const layer = layers.get(s.t.caller.portrait)
    if (layer) {
      const [sx, sy] = S(px + bobX, py + bobY)
      r.push({
        kind: Kind.sprite,
        x: sx,
        y: sy,
        w: MON_W * zk(),
        h: MON_H * zk(),
        uv: [0, 0, 1, 1],
        layer: layer[0],
        layer2: layer[1],
        mix: mouth,
        noise: 0.02,
        bright: isConn ? 1.04 : 0.86,
        blur,
        glitch: 0,
        split: 0,
        roll: -1,
        seed: s.i,
      })
    }

    // Green CRT status pill inside top-left of 4:3 monitor
    rect(px + 10, py + 10, 172, 24, { color: [0, 0, 0, 0.9] })
    text(talking ? "EXCITED · TALK" : urgent ? "WORRIED · IDLE" : "NEUTRAL · IDLE", T.caption, px + 18, py + 22, talking ? GOLD : GREEN_CRT, near)

    // Sunken Stone Nameplate Plaque below 4:3 monitor
    bevelBox(px - 6, py + MON_H + 14, MON_W + 12, 86, STONE_DARK, STONE_HI, STONE_LO, true, 4)
    text(`${s.t.caller.name} — ${court.title}`, T.title, px + MON_W / 2, py + MON_H + 42, GOLD, near + far * 0.9, "center")
    text(s.t.headline, T.small, px + MON_W / 2, py + MON_H + 74, PARCHMENT, near, "center")

    // ── Right Area: Parchment Petition Ledger ──
    const rx = ox + M + MON_W + 44
    bevelBox(rx, py - 6, RIGHT_W, 462, STONE_DARK, STONE_HI, STONE_LO, true, 4)
    text(`PETITIONS & EVIDENCE (${s.items.length})`, T.label, rx + 20, py + 22, GOLD, near)

    s.items.forEach((it, k) => {
      const lit = isConn ? easeOut((t - it.at + 0.15) / 0.35) : 0
      const iy = py + 50 + it.y
      const activeRow = lit > 0.5
      bevelBox(
        rx + 16,
        iy,
        RIGHT_W - 32,
        it.h,
        activeRow ? PARCHMENT : [0.78, 0.72, 0.58],
        PARCHMENT_HI,
        PARCHMENT_LO,
        false,
        3,
      )
      text(`${k + 1}. ${it.label}`, T.label, rx + 32, iy + 20, activeRow ? MAROON : INK, near)
      if (it.when) {
        text(`[${it.when}]`, T.caption, rx + RIGHT_W - 32, iy + 20, MAROON, near, "right")
      }
      it.detail.forEach((d, j) => text(d, T.small, rx + 32, iy + 46 + j * 22, INK, near))
    })

    // ── Bottom Row: Classic Civ II Parchment Speech Box ──
    const sy = oy + 580
    const sh = 280
    if (near > 0.01) {
      bevelBox(ox + M - 6, sy, PANEL.w - 2 * M + 12, sh, PARCHMENT, PARCHMENT_HI, PARCHMENT_LO, false, 5)
    }

    if (far > 0) {
      bevelBox(ox + M - 6, sy, PANEL.w - 2 * M + 12, sh, PARCHMENT, PARCHMENT_HI, PARCHMENT_LO, false, 5)
      s.banner.forEach((line, k) => text(line, T.banner, ox + M + 20, sy + 64 + k * 74, urgent ? MAROON : INK, far * 0.95))
    }

    const wi = isConn && p ? p.word() : -1
    const cur = wi >= 0 ? s.words[wi]!.line : 0
    const scroll = s.scroll.set(Math.max(0, cur - 1)).step(dt)
    if (near > 0.01) {
      for (let k = 0; k < s.words.length; k++) {
        const w = s.words[k]!
        const rel = w.line - scroll
        if (rel < -0.5 || rel > 3.5) continue
        const isCurrent = k === wi
        if (isCurrent) {
          const mw = measure(w.text, T.body).w
          rect(ox + M + 24 + w.x - 4, sy + 36 + rel * LH, mw + 8, 34, { color: rgba(MAROON, 1) })
        }
        text(
          w.text,
          T.body,
          ox + M + 24 + w.x,
          sy + 54 + rel * LH,
          isCurrent ? GOLD : k < wi ? INK : [0.28, 0.22, 0.14],
          near,
        )
      }
    }

    // ── Bottom Win95 / MicroProse Pushbutton Bar ──
    const d = s.t.decree
    if (d && near > 0.01) {
      const y = oy + 916
      bevelBox(ox + M - 6, y - 30, PANEL.w - 2 * M + 12, 60, STONE_DARK, STONE_HI, STONE_LO, true, 3)
      text(`DECREE: ${d.title}`, T.label, ox + M + 14, y, GOLD, near)

      const winBtn = (label: string, bx: number, verdict: "approved" | "dismissed", primary = false) => {
        const active = s.verdict === verdict
        const bw = 212, bh = 42
        bevelBox(
          bx,
          y - bh / 2,
          bw,
          bh,
          active ? [0.58, 0.55, 0.48] : primary ? [0.85, 0.72, 0.33] : WIN_FACE,
          WIN_HI,
          WIN_SHADOW,
          active,
          3,
        )
        text(active ? `✓ ${label}` : label, T.btn, bx + bw / 2, y, INK, near, "center")
        buttons.push({ x: bx, y: y - bh / 2, w: bw, h: bh, run: () => decide(s, verdict) })
      }
      winBtn("Dismiss [D]", ox + PANEL.w - M - 220, "dismissed", false)
      winBtn("Approve Plan [A]", ox + PANEL.w - M - 220 * 2 - 14, "approved", true)
    }

    xf = { cx: 0, cy: 0, k: 1 }
  }

  function drawGalleryRail() {
    const y = PANEL.h + 180
    const x0 = -160, x1 = (stations.length - 1) * PITCH + PANEL.w + 160
    rect(x0, y, x1 - x0, 4, { color: rgba(STONE_HI, 0.8) })
    for (const s of stations) {
      const c = s.x + PANEL.w / 2
      const on = focus === s.i
      const court = COURT_TITLES[s.t.caller.id]
      rect(c - 4, y - 48, 8, 48, { color: rgba(on ? GOLD : STONE_HI, 1) })
      text(`${s.t.caller.name} · ${court?.title ?? s.t.caller.role}`, T.label, c, y + 40, on ? GOLD : PARCHMENT, 1, "center")
    }
  }

  let sized = false
  let lastSize = ""

  const hit = (sx: number, sy: number) => {
    const [wx, wy] = cam.toWorld(sx, sy)
    return { wx, wy, i: stations.findIndex((s) => wx >= s.x && wx <= s.x + PANEL.w && wy >= 0 && wy <= PANEL.h) }
  }

  const input: CodecInput = {
    tap(sx, sy) {
      radio.unlock()
      const { wx, wy, i } = hit(sx, sy)
      for (const b of buttons) if (wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h) return b.run()
      const s = stations[i]
      if (s) {
        if (connected === s.i && s.player) s.player.playing ? s.player.pause() : void s.player.play()
        else tune(s.i)
      } else if (focus !== -1) back()
    },
    hover(sx, sy) { hovered = hit(sx, sy).i },
    key(e) {
      radio.unlock()
      if (e.key === "ArrowRight" || e.key === "l") tune(focus === -1 ? 0 : focus + 1)
      else if (e.key === "ArrowLeft" || e.key === "h") tune(focus === -1 ? stations.length - 1 : focus - 1)
      else if (e.key === "Escape") back()
      else if (e.key === "Enter") tune(Math.max(0, focus))
      else if (e.key === " ") {
        e.preventDefault()
        const s = stations[connected]
        if (s?.player) s.player.playing ? s.player.pause() : void s.player.play()
        else tune(Math.max(0, focus))
      } else if ((e.key === "a" || e.key === "d") && connected >= 0) decide(stations[connected]!, e.key === "a" ? "approved" : "dismissed")
      else if (e.key >= "1" && e.key <= "9") tune(Number(e.key) - 1)
    },
    pan(dx, dy) { cam.pan(dx, dy) },
    zoom(f, sx, sy) { cam.zoomAt(f, sx, sy) },
  }

  function frame(dt: number, now: number, w: number, h: number) {
    time = now
    for (const tm of [...timers]) if (tm.at <= time && tm.tag === epoch) { timers.splice(timers.indexOf(tm), 1); tm.run() }
    cam.step(dt, w, h)
    const size = `${w}x${h}`
    if (!sized) { sized = true; overview(true); cam.step(0, w, h) }
    else if (size !== lastSize) focus === -1 ? overview() : frameStation(focus)
    lastSize = size
    z = cam.zoom
    const v = cam.velocity
    blur = reduced ? [0, 0] : [clamp(v[0] / 60, -40, 40), clamp(v[1] / 60, -40, 40)]
    r.post.burst = burst.step(dt)
    r.reset()
    buttons.length = 0
    drawGalleryRail()
    for (const s of stations) drawStation(s, dt)
  }

  return { frame, input, tune, back }
}
