# High Council

Summon a 1996 *Civilization II* High Council for your day in OpenCode V2 — complete with 4:3 `320×240` Bayer-dithered CD-ROM FMV advisor rigs, chunky Windows 95 / MicroProse stone-and-parchment bevels, rival interjections, and Anarchy mode — plus swappable WebGPU skins (*Metal Gear Solid* Codec, *Star Fox 64* Squadron Comms, *DEFCON* Vector Situation Room, *Into the Breach* Tactical Board, and 16-Bit *SNES Overworld*).

## Quick Start

Run directly with Bun (`>= 1.3.0`):

```bash
# Discover your latest active day in OpenCode V2 (or fall back to the voiced demo)
bunx high-council

# Inspect a specific day of local OpenCode V2 history
bunx high-council --date 2026-10-05

# Launch the voiced fictional demo directly
bunx high-council --demo

# Load a portable briefing or council JSON file
bunx high-council --from ./my-briefing.json

# Open directly into another skin (civ2, codec, starfox, cabinet, defcon, breach, overworld, city)
bunx high-council --date 2026-10-05 --skin codec

# Export a portable daily JSON artifact or record a shareable MP4 clip
bunx high-council --date 2026-10-05 --export ./council-2026-10-05.json
bunx high-council --date 2026-10-05 --record ./council-2026-10-05.mp4
```

Recording is experimental: a silent 10-second preview, not a full narrated briefing.
It requires FFmpeg on your PATH and Chromium installed with `bunx playwright@1.63.0 install chromium`.
JSON exports can contain your project names, session titles, and file names. Review them before sharing.

## How It Works

1. **Read-Only OpenCode V2 Discovery (`--date YYYY-MM-DD`)**
   By default, `high-council` opens `~/.local/share/opencode/opencode.db` (or `--db <path>`) in strictly read-only mode (`readonly: true`, `PRAGMA query_only = 1`). It summarizes that day's sessions, turns, tool dispatches, file churn, prompt-cache hit rate, peak turn latency, and tool error hotspots across your active projects.

2. **Six 1996 CD-ROM FMV Advisors (Default `/` Civ II View)**
   - **Simplifier (Minister of Shears):** Flags high-churn files and net line growth for consolidation.
   - **Performance (Master of Clocks):** Audits peak turn latency, repeated file reads, and prompt cache efficiency.
   - **Bug Hunter (Keeper of the Jar):** Catches failed tool calls, retry loops, and heavily edited modules needing regression guards.
   - **Architect (Grand Mason):** Highlights cross-project and multi-file boundaries touched during the day.
   - **User Voice (Tribune of the People):** Focuses on shipping the day's primary user-facing session threads.
   - **Contrarian (Court Machiavel):** Questions session and subagent sprawl before you open another branch.

3. **Additional WebGPU Skins**
   Switch views at any time from the bottom bar or via `--skin`:
   - `/` (`civ2`): 1996 *Civilization II* CD-ROM High Council (works in any modern browser, no WebGPU required)
   - `/codec` (`codec`): 16-bit *Metal Gear Solid* radio transceiver with lip-synced portraits and frequency band
   - `/starfox` (`starfox`): *Star Fox 64* / Lylat Squadron Comms over a vector horizon
   - `/cabinet` (`cabinet`): WebGPU 4:3 Cinepak FMV council chamber
   - `/defcon` (`defcon`): Glowing phosphor vector situation room with radar sweeps and ballistic arcs
   - `/breach` (`breach`): 8×8 isometric pixel-art tactical island with Mechs and Vek threat telegraphs
   - `/overworld` (`overworld`): 16-bit SNES overworld island with animated hero path travel
   - `/city` (`city`): Procedural 3D isometric project city with switchable pixel, dither, riso, ink, and macro shaders

## Optional Cloud LLM & Voice Setup

By default, `high-council` runs **100% locally** and sends **zero data** over the network:
- Advisor pitches, metrics, viseme tracks, and SoundBlaster-style syllable blips are synthesized locally from your SQLite database.
- The server listens only on `127.0.0.1`. Home directory prefixes and model tokens discovered in the database are scrubbed, but this is not complete anonymization.
- Advisor recommendations are template-based suggestions, not verified code-review findings. Tool errors do not prove bugs, and repeated edits do not prove missing tests.

If you want LLM-written dialogue or neural TTS voices, you can opt in explicitly:

### 1. Optional LLM Drafting (`--model`)
```bash
bunx high-council --date 2026-10-05 --model anthropic/claude-sonnet-4-5
```
When `--model <provider/model>` (or `HIGH_COUNCIL_MODEL`) is set, `high-council` sends a compact JSON digest of that day's project names, file counts, and session titles to your local `opencode` CLI (`POST /api/experimental/generate`, session-less) so the configured model provider writes custom advisor pitches.

### 2. Optional ElevenLabs Voice Synthesis (`--voice`)
```bash
ELEVENLABS_API_KEY=... bunx high-council --date 2026-10-05 --voice
```
When `--voice` is passed, `high-council` sends each advisor's short spoken script (1–3 sentences) to the ElevenLabs `with-timestamps` API to generate MP3 audio and character-aligned viseme cues under `.briefings/<date>/`.

### 3. Optional External Command Sources (`HIGH_COUNCIL_SOURCES`)
To feed optional calendar, todo, or mail summaries into `bun run brief`, point `HIGH_COUNCIL_SOURCES` at a JSON file mapping caller IDs (`chief`, `strategist`, `quartermaster`, `liaison`) to `{ "command": ["your-cli", "--date", "{date}"] }` or `{ "file": "/path/to/notes.txt" }`.

## License

MIT
