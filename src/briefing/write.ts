import { Schema } from "effect"
import type { Caller } from "./callers"
import { Draft } from "./model"
import { STYLE, tells } from "./prose"
import type { Window } from "./sources"

const decodeDraft = Schema.decodeUnknownSync(Draft)

const shape = `{
  "headline": string,            // <= 60 chars, the one-line gist
  "priority": "urgent" | "normal" | "fyi",
  "script": string,              // what you say aloud: 45-75 words (about 20 seconds), spoken English, no lists, no markdown, no emoji
  "dossier": [                   // 3-6 items shown on screen while you talk, in the order you mention them
    { "label": string, "detail": string, "when"?: string }   // label <= 28 chars, detail <= 70 chars, when like "Wed 7pm" or "Oct 21"
  ],
  "decree"?: { "title": string, "steps": string[] }          // optional: one concrete action Kit can approve
}`

export async function gatherContext(caller: Caller, w: Window): Promise<string> {
  const parts = await Promise.all(
    Object.entries(caller.sources).map(async ([title, source]) => {
      try {
        return `## ${title}\n${await source(w)}`
      } catch (e) {
        return `## ${title}\n(unavailable: ${(e as Error).message.slice(0, 120)})`
      }
    }),
  )
  return parts.join("\n\n")
}

export function prompt(caller: Caller, context: string, w: Window): string {
  const userLabel = process.env.HIGH_COUNCIL_USER || "Commander"
  return [
    `You are ${caller.name}, ${userLabel}'s ${caller.role}, calling on a secure radio channel for the daily briefing.`,
    `Persona: ${caller.persona}`,
    `Today is ${w.today.toDateString()}.`,
    `Your brief: ${caller.brief}`,
    `Use only the facts below. Do not invent events or people. Prefer specific dates and names. Address the user as ${userLabel}.`,
    "",
    STYLE,
    "",
    context,
    "",
    "Before replying, reread your script against every rule above and rewrite any sentence that breaks one.",
    "Do not use any tools. Reply with only one JSON object, no prose and no code fences, matching:",
    shape,
  ].join("\n")
}

// Text generation goes through OpenCode's session-less generate endpoint, so drafting
// never adds sessions to the user's list. The directory selects which providers apply.
async function generate(text: string, model: string): Promise<string> {
  const [providerID, ...rest] = model.split("/")
  const [id, variant] = rest.join("/").split("#")
  if (!providerID || !id) throw new Error(`Model must look like provider/model[#variant], got ${model}`)
  const body = JSON.stringify({ prompt: text, model: { providerID, id, ...(variant ? { variant } : {}) } })
  const path = `/api/experimental/generate?directory=${encodeURIComponent(process.cwd())}`
  const p = Bun.spawn(["opencode", "api", "post", path, "--data", body], { stdout: "pipe", stderr: "pipe" })
  const out = await new Response(p.stdout).text()
  if ((await p.exited) !== 0) throw new Error(`generate failed: ${(out + (await new Response(p.stderr).text())).slice(0, 300)}`)
  return (JSON.parse(out) as { data: { text: string } }).data.text
}

const parse = (id: string, text: string) => {
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)
  if (!json) throw new Error(`${id}: no JSON in reply: ${text.slice(0, 200)}`)
  return decodeDraft(JSON.parse(json))
}

// One generate call per caller. If the script trips the prose linter, the model gets
// its own draft back with exactly those problems listed, up to twice.
export async function writeDraft(caller: Caller, context: string, w: Window, model = process.env.BRIEFING_MODEL): Promise<Draft> {
  if (!model) throw new Error("Pass --model provider/model or set BRIEFING_MODEL")
  let draft = parse(caller.id, await generate(prompt(caller, context, w), model))
  for (let attempt = 0; attempt < 2; attempt++) {
    const hits = tells(draft.script)
    if (!hits.length) break
    const fix = [
      prompt(caller, context, w),
      "",
      `Your previous reply was:\n${JSON.stringify(draft)}`,
      `Its script breaks the speaking rules:\n${hits.map((h) => `- ${h}`).join("\n")}`,
      "Rewrite the script in plain, full sentences and keep the same facts. Reply with the whole JSON object again, nothing else.",
    ].join("\n")
    draft = parse(caller.id, await generate(fix, model))
  }
  return draft
}
