import { customSource, opencodeHistory, type Source } from "./sources"

// A caller is a persona plus the sources it reads. Skins decide how it looks;
// the portrait key names an art set the active skin provides.
export interface Caller {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly frequency: string
  readonly portrait: string
  readonly voice: string
  readonly persona: string
  readonly brief: string
  readonly sources: Readonly<Record<string, Source>>
}

export const executiveStaff: ReadonlyArray<Caller> = [
  {
    id: "chief",
    name: "Vesna",
    role: "Chief of Staff",
    frequency: "140.15",
    portrait: "chief",
    voice: "pFZP5JQG7iQjIQuC4Bku",
    persona:
      "A calm, organized chief of staff. She is direct and a little dry, and she speaks in ordinary full sentences.",
    brief:
      "Brief the user on the shape of the day and week: the active project threads, fixed commitments, and the one or two things that will go wrong if forgotten. End with what to do first today.",
    sources: {
      "OpenCode V2 activity": opencodeHistory(),
      "Schedule & commitments (optional)": customSource("chief"),
    },
  },
  {
    id: "strategist",
    name: "Okafor",
    role: "Strategist",
    frequency: "140.48",
    portrait: "strategist",
    voice: "onwK4e9ZLuTAKqWW03F9",
    persona:
      "A thoughtful strategist who cares about what to do first and what to stop doing. He is frank and speaks in ordinary full sentences.",
    brief:
      "Brief the user on their main engineering initiatives. Pick the three that matter most, say why, and propose a sequence. Name one thing to drop or consolidate.",
    sources: {
      "OpenCode V2 activity": opencodeHistory(),
      "Initiatives (optional)": customSource("strategist"),
    },
  },
  {
    id: "quartermaster",
    name: "Brennan",
    role: "Quartermaster",
    frequency: "140.85",
    portrait: "quartermaster",
    voice: "pqHfZKP75CvOlQylNhV4",
    persona:
      "A practical, good-natured quartermaster who keeps operations and logistics running. He sounds a little tired of errands and speaks in ordinary full sentences.",
    brief:
      "Brief the user on operational bottlenecks, tool failures, resource usage, and logistics deadlines. Lead with the hardest deadline or biggest bottleneck.",
    sources: {
      "OpenCode V2 activity": opencodeHistory(),
      "Logistics (optional)": customSource("quartermaster"),
    },
  },
  {
    id: "liaison",
    name: "Imani",
    role: "Liaison",
    frequency: "141.12",
    portrait: "liaison",
    voice: "EXAVITQu4vr4xnSDxMaL",
    persona:
      "A friendly liaison who keeps track of collaborators, user-facing threads, and follow-ups. She is warm without gushing and speaks in ordinary full sentences.",
    brief:
      "Brief the user on user-facing threads, reviews, and people waiting on a follow-up. Suggest one concrete action or reply to send today.",
    sources: {
      "OpenCode V2 activity": opencodeHistory(),
      "People & reviews (optional)": customSource("liaison"),
    },
  },
]
