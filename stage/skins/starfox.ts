import type { Briefing, Transmission } from "../../src/briefing/model"
import { Camera } from "../core/camera"
import { Kind, type Quad, type Renderer } from "../core/gpu"
import { clamp, lerp, Spring } from "../core/motion"
import { ClipPlayer, Radio } from "../core/voice"
import type { CodecInput } from "./codec"

// Star Fox 64 / Lylat Wars Squadron Comms skin:
// Anthropomorphic flight crew portraits in N64 bevelled cobalt-and-gold comms frames,
// scrolling 3D vector flight corridor below, live voice oscilloscope, and target-lock dossiers.

type RGB = [number, number, number]
const CYAN: RGB = [0.48, 0.92, 1.0]
const WHITE: RGB = [0.95, 0.99, 1.0]
const COBALT: RGB = [0.22, 0.54, 0.92]
const NAVY: RGB = [0.03, 0.08, 0.18]
const GOLD: RGB = [1.0, 0.8, 0.24]
const EMERALD: RGB = [0.28, 0.96, 0.56]
const CRIMSON: RGB = [1.0, 0.3, 0.28]
const DIM: RGB = [0.28, 0.48, 0.68]
const rgba = (c: RGB, a = 1): [number, number, number, number] => [c[0], c[1], c[2], a]

const FONT_PIXEL = (w: number) => `${w} {px} 'Silkscreen', ui-monospace, 'SF Mono', Menlo, monospace`
const FONT_BODY = (w: number) => `${w} {px} 'PixelifySans', ui-monospace, 'SF Mono', Menlo, monospace`

interface Type { px: number; font: string; spacing: number; caps: boolean }
const T = {
  caption: { px: 13, font: FONT_PIXEL(700), spacing: 1.4, caps: true },
  small: { px: 17, font: FONT_BODY(500), spacing: 0.2, caps: false },
  label: { px: 18, font: FONT_PIXEL(700), spacing: 0.8, caps: true },
  body: { px: 29, font: FONT_BODY(600), spacing: 0.3, caps: false },
  title: { px: 34, font: FONT_PIXEL(700), spacing: 1.2, caps: true },
  banner: { px: 58, font: FONT_PIXEL(700), spacing: 1.0, caps: true },
} satisfies Record<string, Type>

const CALLSIGNS: Record<string, { sign: string; wing: string; ship: string }> = {
  chief: { sign: "FOX-ACTUAL", wing: "FLIGHT DIRECTOR", ship: "GREAT FOX BRIDGE" },
  strategist: { sign: "FALCON-01", wing: "TACTICAL LEAD", ship: "ARWING INTERCEPTOR" },
  quartermaster: { sign: "BADGER-DECK", wing: "CHIEF ENGINEER", ship: "HANGAR BAY 04" },
  liaison: { sign: "OWL-COMMS", wing: "FLEET LIAISON", ship: "CORNERIA RELAY" },
}

const PANEL = { w: 1600, h: 1000 }
const M = 60
const CW = 440
const PITCH = 1760
const FAR_ZOOM = 0.42
const LH = 44

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
  meter: number
  connectedAt: number
  shakeX: Spring
  shakeY: Spring
  punch: Spring
  lastWord: number
  words: Word[]
  items: Item[]
  headline: string[]
  banner: string[]
  verdict: "approved" | "dismissed" | null
}

export function starfox(r: Renderer, briefing: Briefing, layers: Map<string, [number, number]>) {
  const cam = new Camera()
  const radio = new Radio()
  const burst = new Spring(0, 9, 1)
  let focus = -1
  let connected = -1
  let hovered = -1
  let time = 0
  let ringing = -1
  let epoch = 0
  const timers: { at: number; run: () => void; tag: number }[] = []
  const later = (s: number, run: () => void) => timers.push({ at: time + s, run, tag: epoch })
  const buttons: { x: number; y: number; w: number; h: number; run: () => void }[] = []

  // Configure post-shader for N64 Lylat CRT look
  r.post.scan = 0.45
  r.post.grain = 0.022
  r.post.bloom = 0.78
  r.post.tint = [0.38, 0.85, 1.0]

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

  const RIGHT_W = PANEL.w - 2 * M - CW - 56

  const stations: Station[] = briefing.transmissions.map((t, i) => {
    const clipWords = t.clip?.words ?? []
    const source = clipWords.length ? clipWords.map((w) => w.word) : t.script.split(/\s+/)
    const words: Word[] = []
    const space = measure(" ", T.body).w * 0.6
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
      const detail = wrap(d.detail, T.small, RIGHT_W - 56)
      const h = 36 + detail.length * 24 + 10
      if (y + h > 420) return
      const keys = d.label.split(/\s+/).map(norm).filter((w) => w.length >= 4)
      const off = spoken.slice(cursor).findIndex((w) => keys.includes(w))
      const hit = off >= 0 ? cursor + off : -1
      if (hit >= 0) cursor = hit + 1
      const at = hit >= 0 ? clipWords[hit]!.s : (k / t.dossier.length) * duration * 0.85
      const when = d.when ?? ""
      items.push({ label: d.label, detail, when, y, h, at })
      y += h + 12
    })

    return {
      t, i, x: i * PITCH, words, items,
      headline: wrap(t.headline, T.label, RIGHT_W).slice(0, 2),
      banner: wrap(t.headline, T.banner, PANEL.w - 2 * M).slice(0, 3),
      player: t.clip ? new ClipPlayer(t.clip) : null,
      open: new Spring(1, 16, 0.58),
      live: new Spring(0, 8, 1),
      lift: new Spring(1, 20, 0.7),
      scroll: new Spring(0, 9, 1),
      fill: new Spring(0, 14, 0.8),
      meter: 0, connectedAt: -10, verdict: null,
      shakeX: new Spring(0, 30, 0.7), shakeY: new Spring(0, 30, 0.7), punch: new Spring(1, 22, 0.8),
      lastWord: -1,
    }
  })

  const overview = (snap = false) => {
    const w = stations.length * PITCH - (PITCH - PANEL.w)
    cam.frame(w / 2, PANEL.h / 2 + 120, w + 160, PANEL.h + 480, snap || reduced)
  }
  const frameStation = (i: number, snap = false) =>
    cam.frame(stations[i]!.x + PANEL.w / 2, PANEL.h / 2, PANEL.w + 110, PANEL.h + 70, snap || reduced)

  function hangup() {
    const s = stations[connected]
    if (s) { s.player?.pause(); s.live.set(0); if (!reduced) burst.kick(0.15).set(0) }
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
    later(0.35, () => { radio.chirp(); later(0.38, () => radio.chirp()) })
    later(0.95, () => {
      ringing = -1
      connected = i
      s.connectedAt = time
      if (!reduced) { burst.kick(0.85).set(0); s.open.kick(0.01).set(1); radio.static(0.3) }
      s.live.set(1)
      later(0.4, () => { if (s.player?.ended) s.player.stop(); void s.player?.play() })
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
    radio.chirp()
    if (s.verdict && !reduced) burst.kick(0.18).set(0)
  }

  let z = 1
  let blur: [number, number] = [0, 0]
  let xf = { cx: 0, cy: 0, k: 1 }
  const S = (wx: number, wy: number) => cam.toScreen(xf.cx + (wx - xf.cx) * xf.k, xf.cy + (wy - xf.cy) * xf.k)
  const zk = () => z * xf.k

  function rect(wx: number, wy: number, ww: number, wh: number, o: Partial<Quad>) {
    const [x, y] = S(wx, wy)
    const k = zk()
    r.push({ x, y, w: ww * k, h: wh * k, ...o, radius: (o.radius ?? 0) * k, stroke: o.stroke ? Math.max(1, o.stroke * k) : 0, glow: o.glow ? o.glow * k : undefined })
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

  // Draw scrolling Lylat space starfield & Corneria vector horizon grid
  function drawSpaceBackdrop(w: number, h: number) {
    // Starfield
    for (let i = 0; i < 64; i++) {
      const sx = ((i * 197 + time * (12 + (i % 4) * 9)) % (w + 40)) - 20
      const sy = ((i * 311) % Math.max(100, h * 0.68))
      const sz = (i % 3) + 1.5
      const twinkle = 0.4 + 0.6 * Math.sin(time * 3 + i)
      r.push({ x: sx, y: sy, w: sz, h: sz, color: rgba(i % 5 === 0 ? GOLD : CYAN, twinkle * 0.75) })
    }
    // Scrolling perspective vector horizon at bottom of screen
    const horY = h * 0.72
    r.push({ x: 0, y: horY, w, h: 2, color: rgba(COBALT, 0.45) })
    const rows = 7
    for (let k = 1; k <= rows; k++) {
      const f = ((k / rows + (time * 0.25) % (1 / rows)))
      const y = horY + Math.pow(f, 1.7) * (h - horY)
      if (y < h) r.push({ x: 0, y, w, h: 1, color: rgba(COBALT, 0.12 + f * 0.28) })
    }
    const cols = 16
    for (let c = -cols; c <= cols; c++) {
      const xTop = w * 0.5 + c * (w / 14)
      r.push({ x: xTop, y: horY, w: 1.5, h: h - horY, color: rgba(COBALT, 0.14) })
    }
  }

  function drawStation(s: Station, dt: number) {
    const ox = s.x, oy = 0
    xf = { cx: ox + PANEL.w / 2, cy: oy + PANEL.h / 2, k: s.lift.set(hovered === s.i && focus === -1 ? 1.025 : 1).step(dt) }
    const [sx0] = S(ox, oy)
    if (sx0 > cam.w + 40 || sx0 + PANEL.w * zk() < -40) return

    const isConn = connected === s.i
    const live = s.live.step(dt)
    const open = s.open.step(dt)
    const fill = s.fill.step(dt)
    const p = s.player
    const t = p?.time ?? 0
    const dur = p?.clip.duration ?? 1
    const talking = isConn && !!p?.playing
    const mouth = talking && p!.mouthOpen(Math.floor(t * 12) / 12) ? 1 : 0
    const urgent = s.t.priority === "urgent"
    const hover = hovered === s.i && focus === -1
    const far = clamp((FAR_ZOOM - z) / 0.14, 0, 1)
    const near = 1 - far
    const idle = 0.5 + live * 0.5

    const meta = CALLSIGNS[s.t.caller.id] ?? { sign: `WING-0${s.i + 1}`, wing: s.t.caller.role, ship: "CORNERIA" }

    const drive = talking ? 0.42 + mouth * 0.48 + 0.08 * Math.sin(time * 27) : isConn ? 0.12 : 0.04
    s.meter = lerp(s.meter, drive, 1 - Math.exp(-dt * (drive > s.meter ? 34 : 6)))
    s.shakeX.step(dt); s.shakeY.step(dt); s.punch.step(dt)

    // Outer N64 Comms Chassis
    rect(ox - 28, oy - 28, PANEL.w + 56, PANEL.h + 56, {
      kind: Kind.glow,
      color: rgba(urgent ? GOLD : COBALT, 0.08 + live * 0.12 + (hover ? 0.1 : 0)),
      glow: 55,
      radius: 28,
    })
    rect(ox, oy, PANEL.w, PANEL.h, { color: [0.02, 0.055, 0.13, 0.95], radius: 18 })
    rect(ox, oy, PANEL.w, PANEL.h, { color: rgba(hover ? CYAN : COBALT, 0.55 + live * 0.4), radius: 18, stroke: 3 })
    rect(ox + 12, oy + 12, PANEL.w - 24, PANEL.h - 24, { color: rgba(DIM, 0.45), radius: 12, stroke: 1.5 })

    // Top N64 Squadron Telemetry Header Bar
    rect(ox + 24, oy + 22, PANEL.w - 48, 52, { color: [0.04, 0.12, 0.28, 0.92], radius: 8 })
    rect(ox + 24, oy + 22, PANEL.w - 48, 52, { color: rgba(COBALT, 0.7), radius: 8, stroke: 1.5 })
    text(`★ LYLAT COMMAND // ${meta.ship}`, T.label, ox + 44, oy + 48, CYAN, near)
    text(`CH ${s.t.caller.frequency}`, T.label, ox + 640, oy + 48, GOLD, near)

    // Shield / G-Diffuser Gauge in top right
    text("SHIELD", T.caption, ox + PANEL.w - 340, oy + 48, GOLD, near)
    for (let k = 0; k < 10; k++) {
      const litSeg = k < (urgent ? 7 : 9)
      rect(ox + PANEL.w - 250 + k * 20, oy + 36, 16, 22, {
        color: rgba(litSeg ? (k < 3 ? CRIMSON : k < 6 ? GOLD : EMERALD) : DIM, litSeg ? 0.92 : 0.25),
        radius: 2,
      })
    }

    // ── Left Column: Pilot Comms Window + Oscilloscope ──
    const px = ox + M
    const py = oy + 96
    // Bevelled N64 portrait frame
    rect(px - 8, py - 8, CW + 16, CW + 16, { color: [0.01, 0.03, 0.08, 0.98], radius: 8 })
    rect(px - 8, py - 8, CW + 16, CW + 16, { color: rgba(talking ? EMERALD : urgent ? GOLD : CYAN, 0.88), radius: 8, stroke: 3 })

    const ah = CW * clamp(open, 0.01, 1.04)
    const layer = layers.get(s.t.caller.portrait)
    if (layer) {
      const [sx, sy] = S(px, py + (CW - ah) / 2)
      const v0 = 0.5 - Math.min(ah / CW, 1) * 0.5
      r.push({
        kind: Kind.sprite,
        x: sx,
        y: sy,
        w: CW * zk(),
        h: ah * zk(),
        uv: [0, v0, 1, 1 - v0],
        layer: layer[0],
        layer2: layer[1],
        mix: mouth,
        noise: isConn ? Math.max(0, 0.45 - open * 0.45) + burst.x * 0.25 : ringing === s.i ? 0.22 : 0.03,
        bright: (isConn ? 1.06 : 0.72) * (hover ? 1.15 : 1),
        blur,
        glitch: reduced ? 0 : burst.x * 0.35,
        split: reduced ? 0 : 0.001 + burst.x * 0.006,
        roll: isConn ? (time * 0.09 + s.i * 0.25) % 1 : -1,
        seed: s.i,
      })
    }

    // Corneria live transmission status pill over top of portrait
    const statusLabel = talking ? "● TRANSMITTING" : ringing === s.i ? "▲ INCOMING CALL" : "STANDBY"
    const statusCol = talking ? EMERALD : ringing === s.i ? GOLD : CYAN
    rect(px + 12, py + 12, 186, 26, { color: [0.01, 0.04, 0.1, 0.85], radius: 4 })
    rect(px + 12, py + 12, 186, 26, { color: rgba(statusCol, 0.85), radius: 4, stroke: 1.5 })
    text(statusLabel, T.caption, px + 24, py + 25, statusCol, near)

    // Pilot Callsign & Live Voice Oscilloscope below portrait
    text(s.t.caller.name, T.title, px, oy + 572, WHITE, near + far * 0.9)
    text(`${meta.sign} · ${meta.wing}`, T.caption, px, oy + 604, GOLD, near)

    // 14-bar voice waveform meter next to callsign
    const bars = 12
    for (let k = 0; k < bars; k++) {
      const waveH = talking
        ? 8 + Math.abs(Math.sin(time * 22 + k * 0.7)) * 34 * (0.5 + mouth * 0.5)
        : 6 + (k % 3) * 2
      rect(px + CW - bars * 13 + k * 13, oy + 585 - waveH / 2, 9, waveH, {
        color: rgba(talking ? (k > 8 ? GOLD : EMERALD) : DIM, talking ? 0.95 : 0.45),
        radius: 2,
      })
    }

    // ── Right Area: Mission Target Lock Dossier ──
    const rx = ox + M + CW + 56
    text("MISSION TARGET TELEMETRY", T.label, rx, oy + 108, CYAN, near)
    if (urgent) {
      rect(rx + RIGHT_W - 160, oy + 92, 160, 30, { color: rgba(CRIMSON, 0.22), radius: 6 })
      rect(rx + RIGHT_W - 160, oy + 92, 160, 30, { color: rgba(CRIMSON, 0.95), radius: 6, stroke: 2 })
      text("! PRIORITY ALERT", T.caption, rx + RIGHT_W - 80, oy + 107, CRIMSON, near, "center")
    }
    s.headline.forEach((line, k) => text(line, T.label, rx, oy + 144 + k * 28, GOLD, near))

    s.items.forEach((it, k) => {
      const lit = isConn ? easeOut((t - it.at + 0.15) / 0.35) : 0
      const a = (isConn ? 0.38 + 0.62 * lit : 0.68 * idle) * near
      const iy = oy + 198 + it.y
      const cardCol = urgent && k === 0 ? CRIMSON : lit > 0.5 ? EMERALD : COBALT
      rect(rx, iy, RIGHT_W, it.h, { color: [0.03, 0.09, 0.2, 0.85 * a], radius: 8 })
      rect(rx, iy, RIGHT_W, it.h, { color: rgba(cardCol, (0.45 + 0.5 * lit) * a), radius: 8, stroke: lit > 0.5 ? 2.2 : 1.4 })
      rect(rx + 8, iy + 8, 6, it.h - 16, { color: rgba(cardCol, a), radius: 2 })

      text(`TGT-0${k + 1} // ${it.label}`, T.label, rx + 26, iy + 22, lit > 0.5 ? WHITE : CYAN, a)
      if (it.when) {
        text(it.when, T.caption, rx + RIGHT_W - 18, iy + 22, GOLD, a, "right")
      }
      it.detail.forEach((d, j) => text(d, T.small, rx + 26, iy + 48 + j * 24, WHITE, a * 0.9))
    })

    // ── Bottom Row: Star Fox 64 Comms Dialogue Box ──
    const sy = oy + 636
    const sh = 204
    rect(ox + M, sy, PANEL.w - 2 * M, sh, { color: [0.01, 0.03, 0.09, 0.94 * near], radius: 12 })
    rect(ox + M, sy, PANEL.w - 2 * M, sh, { color: rgba(CYAN, 0.82 * near), radius: 12, stroke: 2.5 })
    rect(ox + M + 6, sy + 6, PANEL.w - 2 * M - 12, sh - 12, { color: rgba(COBALT, 0.45 * near), radius: 8, stroke: 1 })

    if (far > 0) {
      s.banner.forEach((line, k) => text(line, T.banner, ox + M, sy + 64 + k * 76, urgent ? GOLD : CYAN, far * 0.92))
    }

    const wi = isConn && p ? p.word() : -1
    const cur = wi >= 0 ? s.words[wi]!.line : 0
    const scroll = s.scroll.set(Math.max(0, cur - 1)).step(dt)
    if (near > 0.01) {
      for (let k = 0; k < s.words.length; k++) {
        const w = s.words[k]!
        const rel = w.line - scroll
        if (rel < -0.6 || rel > 2.6) continue
        const edge = rel < 0 ? 1 + rel / 0.6 : rel > 2 ? 1 - (rel - 2) / 0.6 : 1
        const said = k <= wi
        const a = (!isConn ? 0.5 * idle : k === wi ? 1 : said ? 0.9 : 0.28) * clamp(edge, 0, 1) * near
        text(w.text, T.body, ox + M + 32 + w.x, sy + 54 + rel * LH, k === wi ? GOLD : said ? WHITE : CYAN, a)
      }
    }

    // ── Wingman Order Bar (Decree) ──
    const d = s.t.decree
    if (d && near > 0.01) {
      const heard = !p || p.ended || t > dur - 1.2 || s.verdict !== null
      const ready = isConn ? (heard ? 1 : 0.45) : 0.45 * idle
      const y = oy + 912
      text("WINGMAN ORDER", T.caption, ox + M, y, GOLD, ready * near)
      text(d.title, T.label, ox + M + 175, y, WHITE, ready * near)

      const btn = (label: string, bx: number, verdict: "approved" | "dismissed", color: RGB) => {
        const active = s.verdict === verdict
        const bw = 208, bh = 52
        rect(bx, y - bh / 2, bw, bh, { color: rgba(color, 0.14 * ready), radius: 8 })
        if (active) rect(bx, y - bh / 2, bw * fill, bh, { color: rgba(color, 0.92), radius: 8 })
        rect(bx, y - bh / 2, bw, bh, { color: rgba(color, 0.9 * ready), radius: 8, stroke: 2 })
        text(
          active ? `★ ${label}` : label,
          T.label,
          bx + bw / 2,
          y,
          active && fill > 0.5 ? NAVY : color,
          Math.max(ready, active ? 1 : 0) * near,
          "center",
        )
        buttons.push({ x: bx, y: y - bh / 2, w: bw, h: bh, run: () => decide(s, verdict) })
      }
      btn("BREAK OFF [D]", ox + PANEL.w - M - 208, "dismissed", CRIMSON)
      btn("CONFIRM [A]", ox + PANEL.w - M - 208 * 2 - 16, "approved", EMERALD)
    }

    xf = { cx: 0, cy: 0, k: 1 }
  }

  function drawBand() {
    const y = PANEL.h + 180
    const x0 = -160, x1 = (stations.length - 1) * PITCH + PANEL.w + 160
    rect(x0, y, x1 - x0, 3, { color: rgba(COBALT, 0.65) })
    for (const s of stations) {
      const c = s.x + PANEL.w / 2
      const on = focus === s.i
      const meta = CALLSIGNS[s.t.caller.id]
      rect(c - 4, y - 48, 8, 48, { color: rgba(on ? GOLD : CYAN, on ? 1 : 0.75), radius: 3 })
      text(`${meta?.sign ?? s.t.caller.name} · ${s.t.caller.frequency}`, T.label, c, y + 40, on ? GOLD : CYAN, 1, "center")
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
    drawSpaceBackdrop(w, h)
    drawBand()
    for (const s of stations) drawStation(s, dt)
  }

  return { frame, input, tune, back }
}
