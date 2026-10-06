import type { Briefing, Transmission } from "../../src/briefing/model"
import { Camera } from "../core/camera"
import { Kind, type Quad, type Renderer } from "../core/gpu"
import { clamp, lerp, Spring } from "../core/motion"
import { ClipPlayer, Radio } from "../core/voice"

// Codec: transmissions sit along a radio band. Fly between them, tune in, and each
// caller speaks with a lip-synced portrait while their dossier lights up as it's mentioned.

// ── design tokens ───────────────────────────────────────────────────────────────

type RGB = [number, number, number]
// Tone carries hierarchy; amber is reserved for urgency and nothing else.
const HI: RGB = [0.66, 1, 0.7]
const MID: RGB = [0.34, 0.74, 0.43]
const LO: RGB = [0.13, 0.33, 0.18]
const AMBER: RGB = [1, 0.74, 0.3]
const RED: RGB = [1, 0.36, 0.3]
const INK: RGB = [0.01, 0.05, 0.025]
const rgba = (c: RGB, a = 1): [number, number, number, number] => [c[0], c[1], c[2], a]

const MONO = (w: number) => `${w} {px} ui-monospace, 'SF Mono', Menlo, monospace`
interface Type { px: number; font: string; spacing: number; caps: boolean }
const T = {
  caption: { px: 14, font: MONO(700), spacing: 2.2, caps: true },
  small: { px: 16, font: MONO(500), spacing: 0, caps: false },
  label: { px: 19, font: MONO(700), spacing: 1, caps: true },
  body: { px: 30, font: MONO(500), spacing: 0, caps: false },
  title: { px: 40, font: MONO(800), spacing: 1.5, caps: true },
  banner: { px: 88, font: MONO(800), spacing: 1, caps: true },
  band: { px: 40, font: MONO(700), spacing: 2, caps: false },
} satisfies Record<string, Type>

// One grid for every panel: 64 margin, three 440 columns, 64 gutters.
const PANEL = { w: 1600, h: 1000 }
const M = 64
const COL = [M, M + 440 + 64, M + 2 * (440 + 64)] as const
const CW = 440
const ROW = { top: 96, name: 584, subs: 640, subsH: 200, decree: 912 }
const LH = 45
const PITCH = 1760
const FAR_ZOOM = 0.42

const SEGMENTS: Record<string, string> = {
  "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc",
  "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcdfg", "-": "g",
}

// Words a codec actor would hit: exclamations, numbers, caps, long held words,
// and anything right after a full stop (a fresh beat).
function emphasisOf(t: Transmission): Set<number> {
  const out = new Set<number>()
  const words = t.clip?.words ?? []
  words.forEach((w, i) => {
        const held = w.e - w.s > 0.3
    if (/!/.test(w.word) || (/\d/.test(w.word) && held)) out.add(i)
  })
  return out
}

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
  glitch: number
  lastWord: number
  lastJolt: number
  dropoutUntil: number
  emphasis: Set<number>
  words: Word[]
  items: Item[]
  headline: string[]
  banner: string[]
  verdict: "approved" | "dismissed" | null
}

export interface CodecInput {
  tap(sx: number, sy: number): void
  hover(sx: number, sy: number): void
  key(e: KeyboardEvent): void
  pan(dx: number, dy: number): void
  zoom(f: number, sx: number, sy: number): void
}

export function codec(r: Renderer, briefing: Briefing, layers: Map<string, [number, number]>) {
  const cam = new Camera()
  const radio = new Radio()
  const burst = new Spring(0, 7, 1)
  let focus = -1
  let connected = -1
  let hovered = -1
  let time = 0
  let ringing = -1
  let epoch = 0
  const timers: { at: number; run: () => void; tag: number }[] = []
  const later = (s: number, run: () => void) => timers.push({ at: time + s, run, tag: epoch })
  const buttons: { x: number; y: number; w: number; h: number; run: () => void }[] = []

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

  const stations: Station[] = briefing.transmissions.map((t, i) => {
    const clipWords = t.clip?.words ?? []
    const source = clipWords.length ? clipWords.map((w) => w.word) : t.script.split(/\s+/)
    const words: Word[] = []
    const space = measure(" ", T.body).w * 0.62
    let x = 0, line = 0
    for (const text of source) {
      const w = measure(text, T.body).w
      if (x > 0 && x + w > PANEL.w - 2 * M - 64) { x = 0; line++ }
      words.push({ text, x, line })
      x += w + space
    }

    // Each dossier item lights up when the caller first says one of its words.
    const spoken = clipWords.map((w) => norm(w.word))
    const duration = t.clip?.duration ?? 1
    let y = 0
    let cursor = 0
    const items: Item[] = []
    t.dossier.forEach((d, k) => {
      const detail = wrap(d.detail, T.small, CW - 48)
      const h = 30 + detail.length * 24
      if (y + h > 400) return
      const keys = d.label.split(/\s+/).map(norm).filter((w) => w.length >= 4)
      // Items are listed in speaking order, so each search starts after the previous hit.
      const off = spoken.slice(cursor).findIndex((w) => keys.includes(w))
      const hit = off >= 0 ? cursor + off : -1
      if (hit >= 0) cursor = hit + 1
      const at = hit >= 0 ? clipWords[hit]!.s : (k / t.dossier.length) * duration * 0.85
      const when = d.when ?? ""
      const room = CW - 20 - (when ? measure(when, T.caption).w + 16 : 0)
      let label = d.label
      while (label.length > 4 && measure(label, T.label).w > room) label = label.slice(0, -2).trimEnd() + "…"
      items.push({ label, detail, when, y, h, at })
      y += h + 22
    })

    return {
      t, i, x: i * PITCH, words, items,
      headline: wrap(t.headline, T.label, CW).slice(0, 3),
      banner: wrap(t.headline, T.banner, PANEL.w - 2 * M).slice(0, 3),
      player: t.clip ? new ClipPlayer(t.clip) : null,
      open: new Spring(1, 15, 0.62),
      live: new Spring(0, 7, 1),
      lift: new Spring(1, 20, 0.7),
      scroll: new Spring(0, 9, 1),
      fill: new Spring(0, 14, 0.8),
      meter: 0, connectedAt: -10, verdict: null,
      // Near-critically damped: a jolt is one small nudge that settles without ringing.
      shakeX: new Spring(0, 30, 0.7), shakeY: new Spring(0, 30, 0.7), punch: new Spring(1, 22, 0.8),
      glitch: 0, lastWord: -1, lastJolt: -10, dropoutUntil: -1,
      emphasis: emphasisOf(t),
    }
  })

  const overview = (snap = false) => {
    const w = stations.length * PITCH - (PITCH - PANEL.w)
    cam.frame(w / 2, PANEL.h / 2 + 160, w + 160, PANEL.h + 560, snap || reduced)
  }
  const frameStation = (i: number, snap = false) =>
    cam.frame(stations[i]!.x + PANEL.w / 2, PANEL.h / 2, PANEL.w + 120, PANEL.h + 80, snap || reduced)

  function hangup() {
    const s = stations[connected]
    if (s) { s.player?.pause(); s.live.set(0); if (!reduced) burst.kick(0.18).set(0) }
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
    // Long hops arc out and back in, so travel reads as moving across the band.
    if (from !== -1 && from !== i && !reduced) {
      const mid = (stations[from]!.x + stations[i]!.x) / 2 + PANEL.w / 2
      cam.x.set(mid)
      cam.logZoom.set(Math.log(Math.min(cam.w / (Math.abs(stations[i]!.x - stations[from]!.x) + PANEL.w * 1.6), cam.h / (PANEL.h * 1.8))))
      later(0.28, () => frameStation(i))
    } else frameStation(i)
    const s = stations[i]!
    if (connected === i) return
    ringing = i
    later(0.5, () => { radio.chirp(); later(0.5, () => radio.chirp()) })
    later(1.3, () => {
      ringing = -1
      connected = i
      s.connectedAt = time
      if (!reduced) { burst.kick(1).set(0); s.open.kick(0.015).set(1); radio.static(0.4) }
      s.live.set(1)
      later(0.55, () => { if (s.player?.ended) s.player.stop(); void s.player?.play() })
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
    if (s.verdict && !reduced) burst.kick(0.22).set(0)
  }

  // ── drawing (station-local world coords → screen) ──────────────────────────────

  let z = 1
  let blur: [number, number] = [0, 0]
  // A station's own transform, so hover lift scales the whole panel about its centre.
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
  function seg(str: string, wx: number, wy: number, h: number, color: RGB, alpha: number) {
    const w = h * 0.52, th = h * 0.11, gap = h * 0.2
    let x = wx
    for (const ch of str) {
      if (ch === ".") { rect(x - gap * 0.55, wy + h - th, th, th, { color: rgba(color, alpha), radius: th / 2 }); continue }
      const on = SEGMENTS[ch] ?? ""
      const segs: Record<string, [number, number, number, number]> = {
        a: [th, 0, w - 2 * th, th], d: [th, h - th, w - 2 * th, th], g: [th, h / 2 - th / 2, w - 2 * th, th],
        f: [0, th, th, h / 2 - th * 1.5], b: [w - th, th, th, h / 2 - th * 1.5],
        e: [0, h / 2 + th / 2, th, h / 2 - th * 1.5], c: [w - th, h / 2 + th / 2, th, h / 2 - th * 1.5],
      }
      for (const [k, [sx, sy, sw, sh]] of Object.entries(segs)) {
        const lit = on.includes(k)
        rect(x + sx, wy + sy, sw, sh, { color: rgba(lit ? color : LO, lit ? alpha : alpha * 0.16), radius: th / 2 })
      }
      x += w + gap
    }
  }
  const segWidth = (str: string, h: number) => [...str].reduce((a, c) => a + (c === "." ? 0 : h * 0.72), 0) - h * 0.2

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
    // Mouth flaps at 12 fps, like hand-timed sprite animation.
    const mouth = talking && p!.mouthOpen(Math.floor(t * 12) / 12) ? 1 : 0
    const urgent = s.t.priority === "urgent"
    const hover = hovered === s.i && focus === -1
    const far = clamp((FAR_ZOOM - z) / 0.14, 0, 1)
    const near = 1 - far
    const idle = 0.42 + live * 0.58

    // Columns brighten left → right after connecting: overlap, not a single flash.
    const since = time - s.connectedAt
    const wave = (k: number) => (isConn ? 0.42 + 0.58 * easeOut((since - k * 0.07) / 0.35) : idle)
    const settle = (k: number) => (isConn ? (1 - easeOut((since - k * 0.07) / 0.45)) * 14 : 0)

    // Codec acting: the voice track drives the portrait. New words nudge the signal,
    // emphatic words jolt the picture and punch in, and long stretches occasionally drop out.
    if (talking && !reduced) {
      const wi = p!.word()
      if (wi !== s.lastWord && wi >= 0) {
        s.lastWord = wi
        const hard = s.emphasis.has(wi) && time - s.lastJolt > 1.5
        if (hard) s.lastJolt = time
        s.glitch = Math.max(s.glitch, hard ? 0.9 : 0.22)
        if (hard) {
          const dir = Math.random() < 0.5 ? -1 : 1
          s.shakeX.v += dir * 260
          s.shakeY.v += (Math.random() - 0.5) * 80
          s.punch.kick(1.015)
        }
        if (Math.random() < 0.035) s.dropoutUntil = time + 0.09 + Math.random() * 0.08
      }
    } else if (!talking) s.lastWord = isConn ? s.lastWord : -1
    // Holds ~0.25 s so a tear survives a few 24 fps frames; open vowels keep a little hum.
    s.glitch = Math.max(s.glitch * Math.exp(-dt * 4.5), talking && mouth ? 0.12 : 0)
    s.shakeX.step(dt); s.shakeY.step(dt); s.punch.step(dt)
    const dropout = time < s.dropoutUntil ? 1 : 0

    // Meter: fast attack, slow release, like a real VU needle.
    const drive = talking ? 0.38 + mouth * 0.42 + 0.08 * Math.sin(time * 23) : isConn ? 0.1 : 0.04
    s.meter = lerp(s.meter, drive, 1 - Math.exp(-dt * (drive > s.meter ? 32 : 5)))

    // chassis
    rect(ox - 30, oy - 30, PANEL.w + 60, PANEL.h + 60, { kind: Kind.glow, color: rgba(MID, 0.04 + live * 0.08 + (hover ? 0.08 : 0)), glow: 60, radius: 40 })
    rect(ox, oy, PANEL.w, PANEL.h, { color: [0.012, 0.034, 0.02, 0.94], radius: 24 })
    rect(ox, oy, PANEL.w, PANEL.h, { color: rgba(hover ? HI : MID, 0.3 + live * 0.35 + (hover ? 0.2 : 0)), radius: 24, stroke: 2 })
    rect(ox + 16, oy + 16, PANEL.w - 32, PANEL.h - 32, { color: rgba(LO, 0.55), radius: 14, stroke: 1 })

    // ── column 1: portrait opens from a scanline with a little overshoot, then acts
    const a1 = wave(0)
    // Shake is sampled at 24 fps so it judders like the original sprites instead of gliding.
    const step24 = (v: number) => Math.round(v * 2) / 2
    const jx = step24(s.shakeX.x), jy = step24(s.shakeY.x)
    const handheld = 0
    const px = ox + COL[0] + jx + handheld, py = oy + ROW.top + jy
    const punch = s.punch.x
    const ah = CW * clamp(open, 0.004, 1.06)
    rect(ox + COL[0] - 10, oy + ROW.top - 10, CW + 20, CW + 20, { color: rgba(MID, 0.5 * a1), radius: 6, stroke: 2 })
    const layer = layers.get(s.t.caller.portrait)
    if (layer) {
      const pw = CW * punch, ph = ah * punch
      const [sx, sy] = S(px - (pw - CW) / 2, py + (CW - ph) / 2)
      const v0 = 0.5 - Math.min(ah / CW, 1) * 0.5
      const g = s.glitch
      r.push({
        kind: Kind.sprite, x: sx, y: sy, w: pw * zk(), h: ph * zk(), uv: [0, v0, 1, 1 - v0],
        layer: layer[0], layer2: layer[1], mix: mouth,
        noise: dropout ? 0.95 : isConn ? Math.max(0, 0.55 - open * 0.55) + burst.x * 0.3 + g * 0.08 : ringing === s.i ? 0.25 + 0.15 * Math.sin(time * 30) : 0.07,
        bright: (isConn ? 1.04 : 0.62) * (hover ? 1.2 : 1) * (1 + g * 0.15), blur,
        glitch: reduced ? 0 : g + burst.x * 0.6,
        split: reduced ? 0 : 0.0015 + g * 0.012 + burst.x * 0.01,
        roll: isConn ? (time * 0.11 + s.i * 0.27) % 1 : -1,
        seed: s.i,
      })
    }
    const fx0 = ox + COL[0], fy0 = oy + ROW.top
    for (const [cx, cy] of [[fx0 - 18, fy0 - 18], [fx0 + CW + 8, fy0 - 18], [fx0 - 18, fy0 + CW + 8], [fx0 + CW + 8, fy0 + CW + 8]] as const)
      rect(cx, cy, 10, 10, { color: rgba(urgent ? AMBER : MID, 0.85 * a1), radius: 2 })
    const nameW = measure(s.t.caller.name, T.title).w
    text(s.t.caller.name, T.title, fx0, oy + ROW.name, HI, a1 * near + far * 0.9)
    text(s.t.caller.role, T.caption, fx0 + nameW + 16, oy + ROW.name + 3, MID, a1 * near)

    // ── column 2: tuner
    const a2 = wave(1), d2 = settle(1)
    const cx = ox + COL[1] + CW / 2
    const ring = ringing === s.i && Math.floor(time * 7) % 2 === 0
    text(talking ? "PTT · TRANSMITTING" : ringing === s.i ? "INCOMING" : "PTT", T.caption, cx, oy + ROW.top + 12, talking || ringing === s.i ? HI : MID, (talking || ring ? 1 : 0.7) * a2 * near, "center")
    const fh = 104
    const freq = s.t.caller.frequency
    const fw = segWidth(freq, fh)
    seg(freq, cx - fw / 2, oy + 136 + d2, fh, HI, a2)
    text("◀", T.label, cx - fw / 2 - 40, oy + 136 + fh / 2 + d2, MID, (ring ? 1 : 0.35) * a2 * near, "center")
    text("▶", T.label, cx + fw / 2 + 40, oy + 136 + fh / 2 + d2, MID, (ring ? 1 : 0.35) * a2 * near, "center")
    const bars = 16, bw = 20, bg = 8
    const bx = cx - (bars * (bw + bg) - bg) / 2
    for (let k = 0; k < bars; k++) {
      const on = (k + 0.5) / bars < s.meter
      const hgt = 14 + k * 3.4
      const hot = k >= 13
      rect(bx + k * (bw + bg), oy + 336 - hgt + d2, bw, hgt, { color: rgba(on ? (hot ? AMBER : HI) : LO, on ? a2 : 0.3 * a2), radius: 3 })
    }
    if (urgent) {
      const pill = measure("Urgent", T.caption).w + 32
      const pulse = isConn ? 1 : 0.6 + 0.4 * Math.sin(time * 4)
      rect(cx - pill / 2, oy + 368 + d2, pill, 30, { color: rgba(AMBER, 0.8 * pulse * a2), radius: 15, stroke: 1.5 })
      text("Urgent", T.caption, cx, oy + 384 + d2, AMBER, pulse * a2 * near, "center")
    }
    s.headline.forEach((line, k) => text(line, T.label, cx, oy + 440 + k * 30 + d2, HI, a2 * near, "center"))

    // ── column 3: dossier
    const a3 = wave(2), d3 = settle(2)
    const dx = ox + COL[2]
    text("Dossier", T.caption, dx, oy + ROW.top + 12, MID, a3 * near)
    text(`${s.items.length} items`, T.caption, dx + CW, oy + ROW.top + 12, LO.map((c) => c * 2) as RGB, a3 * near, "right")
    rect(dx, oy + ROW.top + 32, CW, 1, { color: rgba(MID, 0.45 * a3 * near) })
    s.items.forEach((it, k) => {
      const lit = isConn ? easeOut((t - it.at + 0.15) / 0.35) : 0
      const a = (isConn ? 0.28 + 0.72 * lit : 0.55 * idle) * near
      const nudge = (1 - lit) * (isConn ? 10 : 0)
      const y = oy + ROW.top + 60 + it.y + d3
      const bar = urgent && k === 0 ? AMBER : HI
      rect(dx, y - 10, 3, it.h - 4, { color: rgba(bar, a * (0.35 + 0.65 * lit)), radius: 1.5 })
      text(it.label, T.label, dx + 20 + nudge, y + 4, HI, a)
      text(it.when, T.caption, dx + CW, y + 5, urgent && k === 0 ? AMBER : MID, a, "right")
      it.detail.forEach((d, j) => text(d, T.small, dx + 20 + nudge, y + 32 + j * 24, MID, a))
    })

    // ── row 3: subtitles, three lines, the current one second from top
    const sy = oy + ROW.subs
    rect(ox + M, sy, PANEL.w - 2 * M, ROW.subsH, { color: rgba(INK, 0.6 * near), radius: 10 })
    rect(ox + M, sy, PANEL.w - 2 * M, ROW.subsH, { color: rgba(LO, 0.6 * near), radius: 10, stroke: 1 })
    if (far > 0) s.banner.forEach((line, k) => text(line, T.banner, ox + M, sy + 10 + k * 104, urgent ? AMBER : HI, far * (0.8 + 0.2 * idle)))
    const wi = isConn && p ? p.word() : -1
    const cur = wi >= 0 ? s.words[wi]!.line : 0
    const scroll = s.scroll.set(Math.max(0, cur - 1)).step(dt)
    if (near > 0.01) for (let k = 0; k < s.words.length; k++) {
      const w = s.words[k]!
      const rel = w.line - scroll
      if (rel < -0.7 || rel > 2.7) continue
      const edge = rel < 0 ? 1 + rel / 0.7 : rel > 2 ? 1 - (rel - 2) / 0.7 : 1
      const said = k <= wi
      const a = (!isConn ? 0.32 * idle : k === wi ? 1 : said ? 0.78 : 0.2) * clamp(edge, 0, 1) * near
      text(w.text, T.body, ox + M + 32 + w.x, sy + 55 + rel * LH, said ? HI : MID, a)
    }

    // ── row 4: decree waits until the pitch has been heard
    const d = s.t.decree
    if (d && near > 0.01) {
      const heard = !p || p.ended || t > dur - 1.2 || s.verdict !== null
      const ready = isConn ? (heard ? 1 : 0.32) : 0.32 * idle
      const y = oy + ROW.decree
      text("Decree", T.caption, ox + M, y, urgent ? AMBER : MID, ready * near)
      text(d.title, T.label, ox + M + measure("Decree", T.caption).w + 24, y, HI, ready * near)
      const btn = (label: string, bx: number, verdict: "approved" | "dismissed", color: RGB) => {
        const active = s.verdict === verdict
        const bw = 196, bh = 52
        rect(bx, y - bh / 2, bw, bh, { color: rgba(color, 0.08 * ready), radius: 10 })
        if (active) rect(bx, y - bh / 2, bw * fill, bh, { color: rgba(color, 0.92), radius: 10 })
        rect(bx, y - bh / 2, bw, bh, { color: rgba(color, 0.85 * ready), radius: 10, stroke: 1.5 })
        text(active ? `✓ ${label}` : label, T.label, bx + bw / 2, y, active && fill > 0.5 ? INK : color, Math.max(ready, active ? 1 : 0) * near, "center")
        buttons.push({ x: bx, y: y - bh / 2, w: bw, h: bh, run: () => decide(s, verdict) })
      }
      btn("Dismiss", ox + PANEL.w - M - 196, "dismissed", RED)
      btn("Approve", ox + PANEL.w - M - 196 * 2 - 16, "approved", HI)
    }
    xf = { cx: 0, cy: 0, k: 1 }
  }

  function drawBand() {
    const y = PANEL.h + 220
    const x0 = -200, x1 = (stations.length - 1) * PITCH + PANEL.w + 200
    rect(x0, y, x1 - x0, 2, { color: rgba(MID, 0.55) })
    for (let x = x0, n = 0; x <= x1; x += 88, n++) {
      const major = n % 5 === 0
      rect(x, y - (major ? 36 : 16), 2, major ? 36 : 16, { color: rgba(MID, major ? 0.6 : 0.3) })
    }
    for (const s of stations) {
      const c = s.x + PANEL.w / 2
      const on = focus === s.i
      rect(c - 3, y - 64, 6, 64, { color: rgba(s.t.priority === "urgent" ? AMBER : HI, on ? 1 : 0.75), radius: 3 })
      text(s.t.caller.frequency, T.band, c, y + 56, on ? HI : MID, 1, "center")
    }
    const nx = cam.x.x
    rect(nx - 3, y - 110, 6, 136, { color: rgba(RED, 0.95), radius: 3 })
    rect(nx - 18, y - 128, 36, 36, { kind: Kind.glow, color: rgba(RED, 0.55), glow: 18, radius: 18 })
  }

  function tunedFrequency() {
    const pos = (cam.x.x - PANEL.w / 2) / PITCH
    const i = clamp(Math.floor(pos), 0, stations.length - 1)
    const j = clamp(i + 1, 0, stations.length - 1)
    return lerp(Number(stations[i]!.t.caller.frequency), Number(stations[j]!.t.caller.frequency), clamp(pos - i, 0, 1)).toFixed(2)
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
    const gs = 220 * z
    if (gs > 14) {
      const offx = ((-cam.x.x * z * 0.5) % gs + gs) % gs, offy = ((-cam.y.x * z * 0.5) % gs + gs) % gs
      for (let x = offx; x < w; x += gs) r.push({ x, y: 0, w: 1, h, color: rgba(LO, 0.22) })
      for (let y = offy; y < h; y += gs) r.push({ x: 0, y, w, h: 1, color: rgba(LO, 0.22) })
    }
    drawBand()
    for (const s of stations) drawStation(s, dt)
    if (focus === -1) {
      const f = tunedFrequency()
      const hh = 34
      const [wx, wy] = cam.toWorld(w / 2 - segWidth(f, hh) / 2, h - 72)
      seg(f, wx, wy, hh / z, HI, 0.9)
    }
  }

  return { frame, input, tune, back }
}
