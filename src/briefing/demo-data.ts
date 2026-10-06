import type { Briefing } from "./model"
import { synthesizeClipTiming } from "../opencode-council"

// Built-in portable fictional demo briefing so `/codec`, `/starfox`, `/cabinet`, and
// `bunx high-council --demo` work out of the box in a clean directory with zero config.

function makeDemoClip(id: string, script: string) {
  const timed = synthesizeClipTiming(id, "simplifier", script)
  return {
    url: "",
    duration: timed.duration,
    words: timed.words,
    mouth: timed.visemes.map((v) => ({
      s: v.t,
      e: v.e,
      m: v.v === "closed" ? ("closed" as const) : ("open" as const),
    })),
  }
}

const chiefScript =
  "Good morning, Commander. Daily standup has been moved from nine o'clock to eight fifty-nine, and the organizer's note says it is to assert dominance. You have a dentist appointment on Thursday at ten, followed at two by a sixty-minute planning meeting to schedule next week's meeting. Also, facilities declared the desk fern in sector three officially dead on Monday."

const strategistScript =
  "Three engineering priorities sit on the board this week. Dark mode for the settings page is ninety percent finished even though zero users asked for it. More importantly, that forty-thousand-line legacy module from 2019 only has three callers left, so we can finally delete it by Friday if you stop creating new side-project repositories named final-final-v2."

const quartermasterScript =
  "On household logistics, the sourdough starter on the kitchen counter has doubled in size three times this week and pushed the lid off the jar. Your vehicle registration expires on Friday, and while the earliest in-person appointment is eleven weeks out, online renewal is open right now. Bundle the post office, hardware store, and frying pan return into one loop."

const liaisonScript =
  "On the social channel, the group chat has four hundred twelve unread messages, and four hundred of them are single crab emojis from Dave. Your mom texted yesterday asking whether you tried turning the AI off and on again, and read receipts show you saw it. Reply to her first, then pick up a thirty-th birthday gift for Maya before Saturday."

export const builtInDemoBriefing: Briefing = {
  id: "demo",
  date: "demo",
  generatedAt: 1791200000000,
  transmissions: [
    {
      id: "chief",
      caller: { id: "chief", name: "Vesna", role: "Chief of Staff", frequency: "140.15", portrait: "chief" },
      headline: "Standup moved to 8:59 AM; desk fern declared dead",
      priority: "urgent",
      script: chiefScript,
      dossier: [
        { label: "Standup at 8:59 AM", detail: "Moved 1 minute earlier 'to assert dominance'", when: "Daily 8:59" },
        { label: "Dentist appointment", detail: "Routine checkup; flossing record under review", when: "Thu 10:00 AM" },
        { label: "Pre-meeting planning", detail: "60-minute sync to plan next week's meeting", when: "Thu 2:00 PM" },
        { label: "Sector 3 desk fern", detail: "Declared deceased by facilities; unwatered since August", when: "Facility log" },
      ],
      decree: {
        title: "Decline the pre-meeting and water the replacement fern",
        steps: [
          "Convert Thursday's 60-minute pre-meeting into a 3-line async note",
          "Confirm Thursday 10:00 AM dentist slot",
        ],
      },
      clip: makeDemoClip("demo-chief", chiefScript),
    },
    {
      id: "strategist",
      caller: { id: "strategist", name: "Okafor", role: "Strategist", frequency: "140.48", portrait: "strategist" },
      headline: "Delete the 2019 monolith module; freeze new side repos",
      priority: "urgent",
      script: strategistScript,
      dossier: [
        { label: "Settings dark mode", detail: "90% complete; 0 customer requests on record", when: "Ship or park" },
        { label: "2019 legacy module", detail: "40,000 lines, 3 callers remaining, 0 docs", when: "Delete Fri" },
        { label: "Side-project sprawl", detail: "31 repos in ~/code; 'final-final-v2' created 4m ago", when: "Freeze" },
      ],
      decree: {
        title: "Remove the last 3 callers of the 2019 module",
        steps: [
          "Inline the remaining 3 callers and delete the 40,000-line module",
          "Archive empty side-project repositories created this month",
        ],
      },
      clip: makeDemoClip("demo-strategist", strategistScript),
    },
    {
      id: "quartermaster",
      caller: { id: "quartermaster", name: "Brennan", role: "Quartermaster", frequency: "140.85", portrait: "quartermaster" },
      headline: "Sourdough containment breach; car registration due Friday",
      priority: "urgent",
      script: quartermasterScript,
      dossier: [
        { label: "Sourdough starter", detail: "Tripled in volume; lid pushed off counter jar", when: "Containment" },
        { label: "Vehicle registration", detail: "Expires Friday; online renewal portal is open", when: "Due Fri" },
        { label: "Single errand loop", detail: "Post office, hardware store, and second frying pan return", when: "Sat morning" },
      ],
      decree: {
        title: "Renew vehicle registration online before Friday",
        steps: [
          "Complete online vehicle registration renewal today",
          "Transfer sourdough starter to a larger jar",
        ],
      },
      clip: makeDemoClip("demo-quartermaster", quartermasterScript),
    },
    {
      id: "liaison",
      caller: { id: "liaison", name: "Imani", role: "Liaison", frequency: "141.12", portrait: "liaison" },
      headline: "400 crab emojis in group chat; reply to Mom; Maya's 30th",
      priority: "normal",
      script: liaisonScript,
      dossier: [
        { label: "Group chat crabs", detail: "412 unread messages (400 crab emojis from Dave)", when: "Mute thread" },
        { label: "Text from Mom", detail: "Asked if you tried turning the AI off and on again", when: "Read receipt" },
        { label: "Maya's 30th birthday", detail: "Saturday celebration; gift still needed", when: "Sat" },
      ],
      decree: {
        title: "Reply to Mom and order Maya's birthday gift",
        steps: [
          "Send a reply to Mom today",
          "Pick up Maya's birthday gift before Saturday",
        ],
      },
      clip: makeDemoClip("demo-liaison", liaisonScript),
    },
  ],
}
