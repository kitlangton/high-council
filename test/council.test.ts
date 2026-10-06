import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { builtInDemoBriefing } from "../src/briefing/demo-data"
import {
  buildCouncilFromBriefing,
  buildCouncilFromOpenCodeDay,
  extractOpenCodeDay,
  listOpenCodeDates,
  synthesizeClipTiming,
} from "../src/opencode-council"

test("synthesizeClipTiming produces word and viseme cues", () => {
  const clip = synthesizeClipTiming("test-clip", "simplifier", "Sire, delete the redundant adapter before noon.")
  expect(clip.words.length).toBe(7)
  expect(clip.visemes.length).toBeGreaterThan(10)
  expect(clip.duration).toBeGreaterThan(2)
})

test("buildCouncilFromBriefing maps demo briefing into 6 Civ II advisors", () => {
  const state = buildCouncilFromBriefing(builtInDemoBriefing)
  expect(state.advisors.length).toBe(6)
  for (const adv of state.advisors) {
    expect(state.clips[adv.pitchClipId]).toBeDefined()
  }
})

test("extractOpenCodeDay reads session_v2 read-only and scrubs private model tokens", () => {
  const dir = mkdtempSync(join(tmpdir(), "hc-test-"))
  const dbPath = join(dir, "opencode.db")
  try {
    const db = new Database(dbPath)
    db.exec(`
      CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, sandboxes TEXT NOT NULL);
      CREATE TABLE session_v2 (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_id TEXT, slug TEXT NOT NULL,
        directory TEXT NOT NULL, title TEXT, version TEXT NOT NULL,
        summary_additions INTEGER, summary_deletions INTEGER, summary_files INTEGER,
        cost REAL DEFAULT 0 NOT NULL, tokens_input INTEGER DEFAULT 0 NOT NULL, tokens_cache_read INTEGER DEFAULT 0 NOT NULL,
        model TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL
      );
      CREATE TABLE session_message (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL,
        time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
      );
    `)
    const ts = new Date(2026, 9, 5, 12, 0, 0).getTime()
    db.run(
      `INSERT INTO session_v2 (id, project_id, parent_id, slug, directory, title, version, summary_additions, summary_deletions, summary_files, cost, tokens_input, tokens_cache_read, model, time_created, time_updated)
       VALUES ('ses_1', 'proj_1', NULL, 's1', '/Users/testuser/code/my-app', 'Testing secretcodename99 behavior', '2.0', 120, 45, 4, 0.25, 1000, 4000, '{"providerID":"test","id":"secretcodename99-v1"}', ?, ?)`,
      [ts, ts],
    )
    db.run(
      `INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
       VALUES ('msg_1', 'ses_1', 'assistant', 1, ?, ?, ?)`,
      [
        ts,
        ts,
        JSON.stringify({
          time: { streamed: ts + 1000, completed: ts + 4000 },
          cost: 0.25,
          content: [
            { type: "tool", name: "edit", state: { status: "completed", input: { filePath: "/Users/testuser/code/my-app/src/main.ts" } } },
          ],
        }),
      ],
    )
    db.close()

    const dates = listOpenCodeDates(dbPath)
    expect(dates.length).toBe(1)
    expect(dates[0]?.date).toBe("2026-10-05")

    const digest = extractOpenCodeDay("2026-10-05", dbPath)
    expect(digest).not.toBeNull()
    expect(digest?.primaryRepo).toBe("my-app")
    expect(digest?.topEditedFile?.path).toBe("src/main.ts")

    const { council } = buildCouncilFromOpenCodeDay(digest!)
    const serialized = JSON.stringify(council)
    expect(serialized).not.toContain("secretcodename99")
    expect(serialized).not.toContain("/Users/testuser")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
