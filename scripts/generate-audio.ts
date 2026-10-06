import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";

const OUT_DIR = "public/audio";
mkdirSync(OUT_DIR, { recursive: true });

export type Viseme = "closed" | "open" | "wide" | "round" | "fv";
export type Expression =
  | "neutral"
  | "excited"
  | "worried"
  | "smug"
  | "annoyed";

export interface ClipSpec {
  id: string;
  advisorId: string;
  voiceId: string;
  text: string;
}

const VOICES = {
  simplifier: "pFZP5JQG7iQjIQuC4Bku", // Lily (British actress)
  performance: "pqHfZKP75CvOlQylNhV4", // Bill (crisp older alchemist)
  "bug-hunter": "N2lVS1w4EtoT3dr4eOWO", // Callum (theatrical character)
  architect: "JBFqnCBsd6RMkjVDRZzb", // George (British master builder)
  "user-voice": "EXAVITQu4vr4xnSDxMaL", // Sarah (earnest tribune)
  contrarian: "onwK4e9ZLuTAKqWW03F9", // Daniel (arch court Machiavel)
} as const;

export const CLIPS: ClipSpec[] = [
  // Main Pitches
  {
    id: "simplifier-pitch",
    advisorId: "simplifier",
    voiceId: VOICES.simplifier,
    text: "Sire! Our session hydration layer carries four redundant adapters from the old regime. Give me the shears, and I shall sever three hundred lines before noon!",
  },
  {
    id: "performance-pitch",
    advisorId: "performance",
    voiceId: VOICES.performance,
    text: "My liege, the file watcher scans node modules on every workspace switch! Forty milliseconds wasted per keystroke! Cache the directory tree in memory at once!",
  },
  {
    id: "bug-hunter-pitch",
    advisorId: "bug-hunter",
    voiceId: VOICES["bug-hunter"],
    text: "Look closely, Sire! When a background subagent finishes while a terminal stream is closing, the fiber leaks its lock! One race condition, caught alive in my jar!",
  },
  {
    id: "architect-pitch",
    advisorId: "architect",
    voiceId: VOICES.architect,
    text: "Noble Sovereign, our tool execution boundary mixes transport payloads with domain state! We must erect a proper tagged union schema before chaos consumes the court!",
  },
  {
    id: "user-voice-pitch",
    advisorId: "user-voice",
    voiceId: VOICES["user-voice"],
    text: "Hear the petitions of the people, Sire! Twelve issues this week cry out that pasting a multiline diff into the prompt box swallows the trailing newline!",
  },
  {
    id: "contrarian-pitch",
    advisorId: "contrarian",
    voiceId: VOICES.contrarian,
    text: "Oh, splendid, five more grand crusades! Before you touch a single line of the v2 branch, ask yourself: what if the bug they want to fix is the only load-bearing wall?",
  },

  // Interjections
  {
    id: "contrarian-interject-windows",
    advisorId: "contrarian",
    voiceId: VOICES.contrarian,
    text: "Touch that path resolver and you will break Windows before lunch!",
  },
  {
    id: "simplifier-interject-bloat",
    advisorId: "simplifier",
    voiceId: VOICES.simplifier,
    text: "No more schemas! Another abstraction layer is madness—delete the caller instead!",
  },
  {
    id: "performance-interject-latency",
    advisorId: "performance",
    voiceId: VOICES.performance,
    text: "And allocate on the hot path?! Your grand design will cost us twelve frames!",
  },
  {
    id: "bug-hunter-interject-edgecase",
    advisorId: "bug-hunter",
    voiceId: VOICES["bug-hunter"],
    text: "Careful! If that cache goes stale on a symlink, the bug will multiply!",
  },
  {
    id: "architect-interject-types",
    advisorId: "architect",
    voiceId: VOICES.architect,
    text: "Barbaric! Deleting adapters without a service contract invites lawlessness!",
  },
  {
    id: "user-voice-interject-ship",
    advisorId: "user-voice",
    voiceId: VOICES["user-voice"],
    text: "The users care nothing for your marble towers—just fix the paste buffer!",
  },
];

function charToViseme(ch: string, idx: number): Viseme {
  const c = ch.toLowerCase();
  if ("mbp .,!?;:—-\n\t\"'".includes(c)) return "closed";
  if ("fv".includes(c)) return "fv";
  if ("ouwq".includes(c)) return "round";
  if ("a".includes(c)) return "open";
  if ("eiyszjc".includes(c)) return "wide";
  return idx % 2 === 0 ? "open" : "wide";
}

export interface GeneratedClipManifest {
  id: string;
  advisorId: string;
  text: string;
  audioUrl: string;
  duration: number;
  visemes: Array<{ t: number; e: number; v: Viseme }>;
  words: Array<{ word: string; s: number; e: number }>;
}

const key = process.env.ELEVENLABS_API_KEY;
if (!key) {
  throw new Error("Missing ELEVENLABS_API_KEY");
}

const manifestPath = `${OUT_DIR}/manifest.json`;
const existingManifest: Record<string, GeneratedClipManifest> = existsSync(
  manifestPath,
)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : {};

for (const clip of CLIPS) {
  const mp3Path = `${OUT_DIR}/${clip.id}.mp3`;
  if (
    existsSync(mp3Path) &&
    existingManifest[clip.id] &&
    existingManifest[clip.id]?.text === clip.text
  ) {
    console.log(`Cached ${clip.id}`);
    continue;
  }

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${clip.voiceId}/with-timestamps`,
    {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        text: clip.text,
        model_id: "eleven_v4",
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.75,
        },
      }),
    },
  );

  if (!res.ok) {
    throw new Error(`ElevenLabs failed for ${clip.id}: HTTP ${res.status}`);
  }

  const json = (await res.json()) as {
    audio_base64: string;
    alignment?: {
      characters: string[];
      character_start_times_seconds: number[];
      character_end_times_seconds: number[];
    };
  };

  writeFileSync(mp3Path, Buffer.from(json.audio_base64, "base64"));

  const chars = json.alignment?.characters ?? [];
  const starts = json.alignment?.character_start_times_seconds ?? [];
  const ends = json.alignment?.character_end_times_seconds ?? [];

  const visemes: Array<{ t: number; e: number; v: Viseme }> = [];
  const words: Array<{ word: string; s: number; e: number }> = [];

  let curWord = "";
  let wordStart = 0;
  let wordEnd = 0;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    const s = Number((starts[i] ?? 0).toFixed(3));
    const e = Number((ends[i] ?? s + 0.05).toFixed(3));
    const v = charToViseme(ch, i);

    const prev = visemes[visemes.length - 1];
    if (prev && prev.v === v && Math.abs(prev.e - s) < 0.04) {
      prev.e = e;
    } else {
      visemes.push({ t: s, e, v });
    }

    if (/\s/.test(ch)) {
      if (curWord.length > 0) {
        words.push({ word: curWord, s: wordStart, e: wordEnd });
        curWord = "";
      }
    } else {
      if (curWord.length === 0) wordStart = s;
      curWord += ch;
      wordEnd = e;
    }
  }
  if (curWord.length > 0) {
    words.push({ word: curWord, s: wordStart, e: wordEnd });
  }

  const duration = ends.length > 0 ? Number(ends[ends.length - 1]!.toFixed(3)) : 3.0;
  existingManifest[clip.id] = {
    id: clip.id,
    advisorId: clip.advisorId,
    text: clip.text,
    audioUrl: `/audio/${clip.id}.mp3`,
    duration,
    visemes,
    words,
  };
  console.log(`Generated ${clip.id} (${duration}s, ${visemes.length} visemes)`);
}

writeFileSync(manifestPath, JSON.stringify(existingManifest, null, 2));
console.log("Wrote public/audio/manifest.json");
