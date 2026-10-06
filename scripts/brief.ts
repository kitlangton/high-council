// bun run brief [--days 14] [--model provider/model] [--no-voice]
// Gathers sources, writes one transmission per caller through OpenCode, voices them,
// and saves the briefing under .briefings/<date>/ (gitignored: it's your life).
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { executiveStaff } from "../src/briefing/callers"
import type { Briefing, Transmission } from "../src/briefing/model"
import { elevenlabs, toClip } from "../src/briefing/voice"
import { gatherContext, writeDraft } from "../src/briefing/write"

const { values } = parseArgs({
  options: { days: { type: "string", default: "14" }, model: { type: "string" }, "no-voice": { type: "boolean" } },
})
const today = new Date()
const date = today.toLocaleDateString("en-CA")
const w = { today, days: Number(values.days) }
const dir = join(import.meta.dir, "..", ".briefings", date)
mkdirSync(dir, { recursive: true })
const key = values["no-voice"] ? undefined : process.env.ELEVENLABS_API_KEY

const transmissions = await Promise.all(
  executiveStaff.map(async (caller): Promise<Transmission> => {
    const t0 = performance.now()
    const context = await gatherContext(caller, w)
    writeFileSync(join(dir, `${caller.id}.context.md`), context)
    const draft = await writeDraft(caller, context, w, values.model)
    console.log(`✓ ${caller.role}: ${draft.headline} (${((performance.now() - t0) / 1000).toFixed(1)}s)`)
    const card = { id: caller.id, name: caller.name, role: caller.role, frequency: caller.frequency, portrait: caller.portrait }
    if (!key) return { id: caller.id, caller: card, ...draft }
    const voiced = await elevenlabs(draft.script, caller.voice, key)
    writeFileSync(join(dir, `${caller.id}.mp3`), voiced.audio)
    console.log(`♪ ${caller.role}: ${voiced.duration}s`)
    return { id: caller.id, caller: card, ...draft, clip: toClip(`/briefings/${date}/${caller.id}.mp3`, voiced) }
  }),
)

const briefing: Briefing = { id: date, date, generatedAt: Date.now(), transmissions }
writeFileSync(join(dir, "briefing.json"), JSON.stringify(briefing, null, 2))
console.log(`Saved ${join(dir, "briefing.json")}`)
