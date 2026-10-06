// A scenario is everything the city generator needs: districts and how they feel.
// Real data and demo data both become scenarios, so the map never knows the source.

export type DistrictKind = "downtown" | "residential" | "industrial" | "park" | "campus"

export interface District {
  readonly id: string
  readonly name: string
  readonly kind: DistrictKind
  readonly weight: number      // relative land area
  readonly activity: number    // 0..1, drives height and density
  readonly urgent: number      // count of things due soon; adds cranes and beacons
  readonly stale: number       // 0..1, older districts get dimmer and overgrown
  readonly items: ReadonlyArray<{ title: string; when?: string; urgent?: boolean }>
}

export interface Scenario {
  readonly title: string
  readonly seed: number
  readonly districts: ReadonlyArray<District>
}

export const demoScenario: Scenario = {
  title: "SimCouncil",
  seed: 7,
  districts: [
    {
      id: "monorepo", name: "Monorepo Heights", kind: "downtown", weight: 9, activity: 0.95, urgent: 3, stale: 0,
      items: [
        { title: "Land the reconnect PR series", when: "Wed", urgent: true },
        { title: "Delete the 2019 module (3 callers left)", when: "Fri", urgent: true },
        { title: "Finish dark mode for settings", when: "Thu", urgent: true },
        { title: "Review 18 cleanup PRs" },
      ],
    },
    {
      id: "side-projects", name: "Side Project Suburbs", kind: "residential", weight: 7, activity: 0.5, urgent: 0, stale: 0.3,
      items: [
        { title: "31 repositories, four started this month" },
        { title: "final-final-v2 (created 4 minutes ago)" },
        { title: "The voice app" },
      ],
    },
    {
      id: "infra", name: "Legacy Industrial Park", kind: "industrial", weight: 6, activity: 0.7, urgent: 1, stale: 0.2,
      items: [
        { title: "Database at 480 of 512 MiB", when: "Oct 16", urgent: true },
        { title: "Rotate the production service key" },
        { title: "Migrate off the old host" },
      ],
    },
    {
      id: "ideas", name: "Idea Gardens", kind: "park", weight: 5, activity: 0.3, urgent: 0, stale: 0.1,
      items: [
        { title: "A morning briefing as a SimCity map" },
        { title: "Apartment digital twin" },
        { title: "Garment patterns as code" },
      ],
    },
    {
      id: "home", name: "Household Quarter", kind: "residential", weight: 5, activity: 0.6, urgent: 2, stale: 0,
      items: [
        { title: "Renew car registration online", when: "Fri", urgent: true },
        { title: "The sourdough starter needs a bigger jar", when: "Today", urgent: true },
        { title: "Return the second frying pan", when: "Sat" },
      ],
    },
    {
      id: "people", name: "Social Campus", kind: "campus", weight: 4, activity: 0.55, urgent: 1, stale: 0,
      items: [
        { title: "Reply to Mom", when: "Today", urgent: true },
        { title: "Maya turns 30", when: "Sat" },
        { title: "412 unread in the group chat" },
      ],
    },
    {
      id: "docs", name: "Old Docs Quarter", kind: "campus", weight: 3, activity: 0.15, urgent: 0, stale: 0.9,
      items: [{ title: "README last touched in March" }, { title: "Tutorial that still says catchAll" }],
    },
  ],
}
