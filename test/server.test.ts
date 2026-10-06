import { expect, test } from "bun:test"
import { builtInDemoBriefing } from "../src/briefing/demo-data"
import { buildCouncilFromBriefing } from "../src/opencode-council"
import { demoScenario } from "../stage/city/scenario"
import { startCouncilServer } from "../src/server"

test("server binds only to loopback and serves the generated bundle unchanged", async () => {
  const base = buildCouncilFromBriefing(builtInDemoBriefing)
  const clipId = base.advisors[0]!.pitchClipId
  const council = {
    ...base,
    clips: {
      ...base.clips,
      [clipId]: {
        ...base.clips[clipId]!,
        text: "Sire, this is the explicitly generated script.",
        audioUrl: "/briefings/2026-10-05/generated.mp3",
      },
    },
  }
  const server = startCouncilServer({
    port: 0,
    dbPath: "missing-fixture.db",
    defaultDate: "2026-10-05",
    initialBundle: { council, briefing: builtInDemoBriefing, scenario: demoScenario },
  })
  try {
    expect(server.hostname).toBe("127.0.0.1")
    const response = await fetch(`http://127.0.0.1:${server.port}/api/council?date=2026-10-05`)
    expect(response.status).toBe(200)
    const served = await response.json()
    expect(served.clips).toEqual(council.clips)
  } finally {
    server.stop(true)
  }
})
