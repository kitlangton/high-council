// Fictional briefing for demos and recordings. Callers write their scripts from made-up
// fact sheets through the same writer as real briefings.
//
//   bun run demo-brief --model provider/model --label a   → .briefings/demo-a/ (text only)
//   bun run demo-brief --voice --from demo-a                     → .briefings/demo/ (voiced, for `bun run record`)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { executiveStaff } from "../src/briefing/callers"
import type { Briefing, Draft, Transmission } from "../src/briefing/model"
import { elevenlabs, toClip } from "../src/briefing/voice"
import { writeDraft } from "../src/briefing/write"

const facts: Record<string, string> = {
  chief: `## Calendar (fictional)
- Daily standup has been moved from 9:00 to 8:59. The organizer's note says "to assert dominance".
- Thu 10:00: dentist. No flossing since March.
- Thu 14:00: a 60-minute meeting whose agenda is to plan next week's meeting.
- Fri 13:00: guest on a podcast called "Synergy Hour". The episode runs 90 minutes.
## Office
- The office fern on the desk was declared dead by facilities on Monday. Nobody has watered it since August.`,
  strategist: `## Initiatives (fictional)
- Dark mode for the settings page. Zero users have asked for it, but it is 90% done.
- A 40,000-line module written at 2am in 2019. It has 3 callers left and nobody understands it.
- 31 side projects in ~/code. Four were started this month.
- A new empty repository named "final-final-v2" was created four minutes ago.`,
  quartermaster: `## Household (fictional)
- The sourdough starter on the counter has doubled in size three times this week and pushed the lid off the jar.
- Car registration expires Friday. The earliest DMV appointment is in eleven weeks; online renewal is open.
- Returned a frying pan, bought a different one, and now need to return that one too.
- These errands are all on one route: post office, hardware store, the pan return, and the dry cleaner.`,
  liaison: `## People (fictional)
- The friends group chat has 412 unread messages. 400 of them are from Dave, and each one is a single crab emoji.
- Mom texted yesterday asking whether you have tried turning the AI off and on again. Read receipts show it was seen.
- Cousin Maya turns 30 on Saturday. No gift yet.`,
}

const { values } = parseArgs({
  options: { model: { type: "string" }, label: { type: "string" }, voice: { type: "boolean" }, from: { type: "string" } },
})
const root = join(import.meta.dir, "..", ".briefings")
const w = { today: new Date("2026-10-05T09:00:00"), days: 14 }

let drafts: Record<string, Draft>
if (values.from) {
  const b = JSON.parse(readFileSync(join(root, values.from, "briefing.json"), "utf8")) as Briefing
  drafts = Object.fromEntries(b.transmissions.map((t) => [t.id, { headline: t.headline, priority: t.priority, script: t.script, dossier: t.dossier, decree: t.decree }]))
} else {
  drafts = Object.fromEntries(
    await Promise.all(executiveStaff.map(async (c) => {
      const d = await writeDraft(c, facts[c.id]!, w, values.model)
      console.log(`✓ ${c.role}: ${d.headline}`)
      return [c.id, d] as const
    })),
  )
}

const key = values.voice ? process.env.ELEVENLABS_API_KEY : undefined
if (values.voice && !key) throw new Error("Missing ELEVENLABS_API_KEY")
const name = values.voice ? "demo" : `demo-${values.label ?? "draft"}`
const dir = join(root, name)
mkdirSync(dir, { recursive: true })

const transmissions = await Promise.all(
  executiveStaff.map(async (caller): Promise<Transmission> => {
    const draft = drafts[caller.id]!
    const card = { id: caller.id, name: caller.name, role: caller.role, frequency: caller.frequency, portrait: caller.portrait }
    if (!key) return { id: caller.id, caller: card, ...draft }
    const voiced = await elevenlabs(draft.script, caller.voice, key)
    writeFileSync(join(dir, `${caller.id}.mp3`), voiced.audio)
    console.log(`♪ ${caller.role}: ${voiced.duration}s`)
    return { id: caller.id, caller: card, ...draft, clip: toClip(`/briefings/${name}/${caller.id}.mp3`, voiced) }
  }),
)
const briefing: Briefing = { id: name, date: name, generatedAt: Date.now(), transmissions }
writeFileSync(join(dir, "briefing.json"), JSON.stringify(briefing, null, 2))
console.log(`Saved ${join(dir, "briefing.json")}`)
