// Plain-speech rules for every spoken script, plus a linter that catches the common
// AI tells so the writer can be asked to fix them before anything is voiced.

export const STYLE = `How to speak:
- Talk like a smart, relaxed colleague on the phone. Use full, connected sentences with verbs, joined with "and", "but", "because" and "so" where they belong.
- Lead with the point, then the detail that matters. Use concrete names, numbers and dates instead of adjectives.
- Default to medium-length sentences. Never string together very short sentences.
- Use contractions and everyday words.
- Any humor comes from true, specific details said plainly. Never write a punchline.
Never do any of these:
- Verbless fragments or clipped one-liners for effect, like "One database. Five connections." or "Bad news first:".
- Dramatic setups or reveals: "Here's the thing", "The catch?", "Plot twist", "Spoiler".
- "Not X, but Y" or "It's not just X, it's Y".
- Lists of three for rhythm.
- Metaphors or scenery in place of a plain claim.
- These words: delve, tapestry, testament, seamless, robust, elevate, unlock, unleash, game-changer, landscape, realm, journey, navigate, crucial, pivotal, vibrant, nuanced.
- Hype, exclamation marks, or wink endings like "You're welcome" or "Simple as that". End on the last useful fact.
- Em dashes, or colons used for a reveal.`

const SLOP = /\b(delve|tapestry|testament|seamless|robust|elevate|unlock|unleash|game-changer|landscape|realm|journey|navigat\w*|crucial|pivotal|vibrant|nuanced)\b/i
const SETUP = /\b(here's the thing|the catch\b|plot twist|spoiler|bad news first|good news first|simple as that|you're welcome|food for thought|that's the whole)/i
const NOT_BUT = /\bnot (just |only )?[^.,;]{1,40}, (but|it's)\b|\bit's not just\b/i
// A crude verb check: a sentence counts as complete if it has a common verb form.
const VERB = /\b(is|are|was|were|be|been|am|has|have|had|do|does|did|can|could|will|would|should|must|may|might|need|needs|want|wants|'s|'re|'ve|'ll|'d)\b|\b\w+(ed|ing|es|s)\b/i

export function tells(script: string): string[] {
  const hits: string[] = []
  if (/—|–/.test(script)) hits.push("uses an em dash")
  if (/!/.test(script)) hits.push("uses an exclamation mark")
  const slop = script.match(SLOP)
  if (slop) hits.push(`uses the word "${slop[0]}"`)
  const setup = script.match(SETUP)
  if (setup) hits.push(`uses the setup "${setup[0]}"`)
  if (NOT_BUT.test(script)) hits.push(`uses "not X, but Y" framing`)
  if (/:\s/.test(script)) hits.push("uses a colon (rephrase as a sentence)")
  const sentences = script.split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter(Boolean)
  for (const s of sentences) {
    const words = s.split(/\s+/).length
    if (words <= 6 && !VERB.test(s)) hits.push(`fragment: "${s}"`)
  }
  let run = 0
  for (const s of sentences) {
    run = s.split(/\s+/).length <= 6 ? run + 1 : 0
    if (run === 2) hits.push("two very short sentences in a row")
  }
  return [...new Set(hits)]
}
