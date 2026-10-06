import type { Clip } from "../../src/briefing/model"
import { clock } from "./motion"

// Frame-exact capture runs on virtual time: clips keep their own clock instead of
// playing, and every sound is logged so a recorder can mix the soundtrack afterwards.
export interface SoundEvent { kind: "clip" | "chirp" | "static" | "tick"; at: number; url?: string; from?: number }
const capture = (): SoundEvent[] | null => (globalThis as any).__sounds ?? null
const now = () => clock() / 1000

// Plays a clip and answers timing questions (mouth, current word) from its cues.
export class ClipPlayer {
  readonly audio: HTMLAudioElement
  private v = { offset: 0, startedAt: -1 }
  constructor(readonly clip: Clip) {
    this.audio = new Audio(clip.url)
    this.audio.preload = capture() ? "none" : "auto"
  }
  get time() {
    if (!capture()) return this.audio.currentTime
    const t = this.v.startedAt < 0 ? this.v.offset : this.v.offset + now() - this.v.startedAt
    return Math.min(t, this.clip.duration)
  }
  get ended() { return capture() ? this.time >= this.clip.duration : this.audio.ended }
  get playing() { return capture() ? this.v.startedAt >= 0 && !this.ended : !this.audio.paused && !this.audio.ended }
  play() {
    const log = capture()
    if (!log) return this.audio.play().catch(() => {})
    if (this.v.startedAt < 0) { this.v.startedAt = now(); log.push({ kind: "clip", at: now(), url: this.clip.url, from: this.v.offset }) }
    return Promise.resolve()
  }
  pause() {
    if (!capture()) return this.audio.pause()
    if (this.v.startedAt >= 0) { this.v.offset = this.time; this.v.startedAt = -1; capture()!.push({ kind: "clip", at: now(), url: "" }) }
  }
  stop() {
    if (!capture()) { this.audio.pause(); this.audio.currentTime = 0; return }
    this.pause(); this.v.offset = 0
  }
  mouthOpen(t = this.time): boolean {
    const m = this.clip.mouth
    let lo = 0, hi = m.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const c = m[mid]!
      if (t < c.s) hi = mid - 1
      else if (t >= c.e) lo = mid + 1
      else return c.m === "open"
    }
    return false
  }
  // Index of the last word that has started.
  word(t = this.time): number {
    const w = this.clip.words
    let lo = 0, hi = w.length - 1, ans = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (w[mid]!.s <= t) { ans = mid; lo = mid + 1 } else hi = mid - 1
    }
    return ans
  }
}

// Original synthesized radio sounds: a two-tone call chirp and a burst of tuned static.
export class Radio {
  private ctx: AudioContext | null = null
  private get ac() { return (this.ctx ??= new AudioContext()) }
  unlock() { if (!capture()) void this.ac.resume() }
  chirp(at = 0) {
    if (capture()) return void capture()!.push({ kind: "chirp", at: now() + at })
    const ac = this.ac, t0 = ac.currentTime + at
    for (let i = 0; i < 4; i++) {
      const o = ac.createOscillator(), g = ac.createGain()
      o.type = "square"
      o.frequency.value = i % 2 ? 1180 : 1560
      g.gain.setValueAtTime(0, t0 + i * 0.075)
      g.gain.linearRampToValueAtTime(0.05, t0 + i * 0.075 + 0.005)
      g.gain.setValueAtTime(0.05, t0 + i * 0.075 + 0.06)
      g.gain.linearRampToValueAtTime(0, t0 + i * 0.075 + 0.07)
      o.connect(g).connect(ac.destination)
      o.start(t0 + i * 0.075); o.stop(t0 + i * 0.075 + 0.08)
    }
  }
  static(dur = 0.35, level = 0.08) {
    if (capture()) return void capture()!.push({ kind: "static", at: now() })
    const ac = this.ac
    const len = Math.floor(ac.sampleRate * dur)
    const b = ac.createBuffer(1, len, ac.sampleRate)
    const d = b.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain()
    src.buffer = b; f.type = "bandpass"; f.frequency.value = 2400; f.Q.value = 0.7; g.gain.value = level
    src.connect(f).connect(g).connect(ac.destination)
    src.start()
  }
  tick() {
    if (capture()) return void capture()!.push({ kind: "tick", at: now() })
    const ac = this.ac, o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime
    o.type = "square"; o.frequency.value = 2200
    g.gain.setValueAtTime(0.025, t); g.gain.linearRampToValueAtTime(0, t + 0.02)
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.03)
  }
}
