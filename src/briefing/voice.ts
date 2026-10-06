import type { Clip, MouthCue, WordCue } from "./model"

// Voice providers turn a script into audio plus word and mouth timing.
export interface Voiced {
  readonly audio: Uint8Array
  readonly duration: number
  readonly words: WordCue[]
  readonly mouth: MouthCue[]
}

const closedChars = new Set([..."mbp .,!?;:—-\n\t\"'"])

// Character alignment → word cues and a two-frame mouth track, with tiny gaps merged
// so the jaw doesn't flutter faster than a 1998 codec portrait would.
export function timing(chars: string[], starts: number[], ends: number[]) {
  const words: WordCue[] = []
  const mouth: { s: number; e: number; m: MouthCue["m"] }[] = []
  let word = ""
  let ws = 0
  let we = 0
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!
    const s = starts[i] ?? 0
    const e = ends[i] ?? s + 0.05
    const m = closedChars.has(ch.toLowerCase()) ? "closed" : "open"
    const prev = mouth[mouth.length - 1]
    if (prev && (prev.m === m || e - s < 0.02)) prev.e = e
    else mouth.push({ s, e, m })
    if (/\s/.test(ch)) {
      if (word) words.push({ word, s: ws, e: we })
      word = ""
    } else {
      if (!word) ws = s
      word += ch
      we = e
    }
  }
  if (word) words.push({ word, s: ws, e: we })
  // Short open runs read as flicker; fold them into neighbours.
  const merged: typeof mouth = []
  for (const c of mouth) {
    const last = merged[merged.length - 1]
    if (last && (c.e - c.s < 0.06 || last.m === c.m)) last.e = c.e
    else merged.push({ ...c })
  }
  const round = (n: number) => Math.round(n * 1000) / 1000
  return {
    words: words.map((w) => ({ word: w.word, s: round(w.s), e: round(w.e) })),
    mouth: merged.map((c) => ({ s: round(c.s), e: round(c.e), m: c.m })),
    duration: round(ends[ends.length - 1] ?? 0),
  }
}

export async function elevenlabs(text: string, voice: string, key: string): Promise<Voiced> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_v4", voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
  })
  if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = (await res.json()) as {
    audio_base64: string
    alignment: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }
  }
  const a = json.alignment
  return { audio: Buffer.from(json.audio_base64, "base64"), ...timing(a.characters, a.character_start_times_seconds, a.character_end_times_seconds) }
}

export const toClip = (url: string, v: Voiced): Clip => ({ url, duration: v.duration, words: v.words, mouth: v.mouth })
