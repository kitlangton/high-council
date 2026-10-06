import { Context, Effect, Layer, Ref } from "effect";
import { existsSync, readFileSync } from "node:fs";
import {
  type Advisor,
  type AdvisorId,
  type AudioClip,
  CouncilAction,
  type DecisionStatus,
} from "./domain";

const INITIAL_ADVISORS: ReadonlyArray<Advisor> = [
  {
    id: "simplifier",
    name: "Simplifier",
    icon: "🧹",
    accent: "#4aa8d8",
    pitchClipId: "simplifier-pitch",
    pitchTitle: "Delete 4 legacy session hydration adapters (-312 LOC)",
    pitchExpression: "excited",
    councilReactions: {
      simplifier: "excited",
      performance: "smug",
      "bug-hunter": "worried",
      architect: "annoyed",
      "user-voice": "neutral",
      contrarian: "smug",
    },
    interjections: [
      {
        advisorId: "architect",
        clipId: "architect-interject-types",
        expression: "annoyed",
        targetExpression: "smug",
      },
      {
        advisorId: "contrarian",
        clipId: "contrarian-interject-windows",
        expression: "smug",
        targetExpression: "annoyed",
      },
    ],
    evidence: {
      targetFile: "packages/opencode/src/session/hydrate.ts",
      refLabel: "v2 · 4 dead shims",
      metric: "-312 LOC",
      diffPreview: `- export const hydrateV1Fallback = (raw: unknown) => ...
- export const normalizeLegacyTurn = (turn: LegacyTurn) => ...
+ export const decodeSession = Schema.decodeUnknownEffect(SessionRow)`,
      prPlanSteps: [
        "Remove hydrateV1Fallback and normalizeLegacyTurn in packages/opencode/src/session/hydrate.ts",
        "Inline direct Schema.decodeUnknownEffect(SessionRow) at the single SQLite reader call site",
        "Delete orphaned legacy fixture snapshots in packages/opencode/test/session/",
      ],
    },
    status: "pending",
  },
  {
    id: "performance",
    name: "Performance",
    icon: "⚡",
    accent: "#f0b429",
    pitchClipId: "performance-pitch",
    pitchTitle: "Memoize workspace directory tree across tab switches (-40ms/key)",
    pitchExpression: "excited",
    councilReactions: {
      simplifier: "worried",
      performance: "excited",
      "bug-hunter": "worried",
      architect: "neutral",
      "user-voice": "excited",
      contrarian: "smug",
    },
    interjections: [
      {
        advisorId: "bug-hunter",
        clipId: "bug-hunter-interject-edgecase",
        expression: "worried",
        targetExpression: "annoyed",
      },
    ],
    evidence: {
      targetFile: "packages/opencode/src/file/watcher.ts",
      refLabel: "v2 · hot path",
      metric: "42ms → 1.4ms",
      diffPreview: `- const entries = await scanWorkspaceRoots(dir)
+ const entries = yield* treeCache.get(dir) // Cache.make({ capacity: 32, timeToLive: "5 minutes" })`,
      prPlanSteps: [
        "Introduce an Effect Cache.make keyed by canonical workspace root in FileWatcherService",
        "Invalidate individual subtrees on fs.watch rename events instead of full-tree rescan",
        "Add benchmark assertion guarding <2ms warm lookup on 50k-file worktrees",
      ],
    },
    status: "pending",
  },
  {
    id: "bug-hunter",
    name: "Bug Hunter",
    icon: "🐛",
    accent: "#3dd68c",
    pitchClipId: "bug-hunter-pitch",
    pitchTitle: "Fix leaked semaphore lock when subagent aborts during PTY close",
    pitchExpression: "excited",
    councilReactions: {
      simplifier: "neutral",
      performance: "worried",
      "bug-hunter": "excited",
      architect: "worried",
      "user-voice": "excited",
      contrarian: "annoyed",
    },
    interjections: [
      {
        advisorId: "contrarian",
        clipId: "contrarian-interject-windows",
        expression: "smug",
        targetExpression: "worried",
      },
    ],
    evidence: {
      targetFile: "packages/opencode/src/pty/session-lock.ts",
      refLabel: "Issue #4812 · race",
      metric: "Deadlock on Ctrl+C",
      diffPreview: `- yield* lock.take(1)
- yield* closeStream(pty)
- yield* lock.release(1)
+ yield* lock.withPermits(1)(closeStream(pty))`,
      prPlanSteps: [
        "Wrap PTY teardown in lock.withPermits(1) so fiber interruption guarantees permit release",
        "Add TestClock fiber-interruption regression test reproducing concurrent child exit + tab close",
      ],
    },
    status: "pending",
  },
  {
    id: "architect",
    name: "Architect",
    icon: "🏛",
    accent: "#5c8df6",
    pitchClipId: "architect-pitch",
    pitchTitle: "Split ToolTransportPayload from ToolDomainState via TaggedUnion",
    pitchExpression: "smug",
    councilReactions: {
      simplifier: "annoyed",
      performance: "annoyed",
      "bug-hunter": "neutral",
      architect: "smug",
      "user-voice": "annoyed",
      contrarian: "smug",
    },
    interjections: [
      {
        advisorId: "simplifier",
        clipId: "simplifier-interject-bloat",
        expression: "annoyed",
        targetExpression: "annoyed",
      },
      {
        advisorId: "performance",
        clipId: "performance-interject-latency",
        expression: "annoyed",
        targetExpression: "worried",
      },
    ],
    evidence: {
      targetFile: "packages/opencode/src/tool/boundary.ts",
      refLabel: "v2 · boundary",
      metric: "6 ad-hoc switches",
      diffPreview: `+ export const ToolStage = Schema.TaggedUnion({
+   Pending: { callId: ToolCallId },
+   Running: { callId: ToolCallId, startedAt: Schema.Number },
+   Completed: { callId: ToolCallId, output: Schema.String },
+ })`,
      prPlanSteps: [
        "Define ToolStage Schema.TaggedUnion in packages/opencode/src/tool/boundary.ts",
        "Replace 6 ad-hoc status string switches across TUI and HTTP routes with exhaustive match",
      ],
    },
    status: "pending",
  },
  {
    id: "user-voice",
    name: "User Voice",
    icon: "🗣",
    accent: "#d966a8",
    pitchClipId: "user-voice-pitch",
    pitchTitle: "Preserve trailing newline when pasting multiline unified diffs",
    pitchExpression: "worried",
    councilReactions: {
      simplifier: "excited",
      performance: "neutral",
      "bug-hunter": "excited",
      architect: "annoyed",
      "user-voice": "worried",
      contrarian: "neutral",
    },
    interjections: [
      {
        advisorId: "user-voice",
        clipId: "user-voice-interject-ship",
        expression: "annoyed",
        targetExpression: "worried",
      },
    ],
    evidence: {
      targetFile: "packages/opencode/src/tui/prompt-input.ts",
      refLabel: "12 issues · papercut",
      metric: "2-line fix",
      diffPreview: `- const cleaned = pastedText.trimEnd()
+ const cleaned = pastedText.replace(/\\r\\n/g, "\\n")`,
      prPlanSteps: [
        "Stop stripping trailing newline in normalizeBracketedPaste when input contains >1 line",
        "Add TUI paste snapshot test covering unified git diffs and fenced code blocks",
      ],
    },
    status: "pending",
  },
  {
    id: "contrarian",
    name: "Contrarian",
    icon: "😈",
    accent: "#e5484d",
    pitchClipId: "contrarian-pitch",
    pitchTitle: "Freeze all refactors until cold-start stays under 80ms",
    pitchExpression: "smug",
    councilReactions: {
      simplifier: "annoyed",
      performance: "excited",
      "bug-hunter": "annoyed",
      architect: "annoyed",
      "user-voice": "annoyed",
      contrarian: "smug",
    },
    interjections: [
      {
        advisorId: "simplifier",
        clipId: "simplifier-interject-bloat",
        expression: "annoyed",
        targetExpression: "smug",
      },
      {
        advisorId: "architect",
        clipId: "architect-interject-types",
        expression: "annoyed",
        targetExpression: "smug",
      },
    ],
    evidence: {
      targetFile: "packages/opencode/src/index.ts",
      refLabel: "v2 · startup gate",
      metric: "19 imports at boot",
      diffPreview: `+ // Gate CI on cold-start wall clock before merging new service layers
+ expect(bootDurationMs).toBeLessThan(80)`,
      prPlanSteps: [
        "Add cold-start gate in CI measuring `opencode --version` wall clock",
        "Defer optional MCP transport schemas until first server connection",
      ],
    },
    status: "pending",
  },
];

export interface CouncilState {
  readonly repo: string;
  readonly branch: string;
  readonly advisors: ReadonlyArray<Advisor>;
  readonly clips: Readonly<Record<string, AudioClip>>;
}

export class CouncilService extends Context.Service<
  CouncilService,
  {
    readonly getState: () => Effect.Effect<CouncilState>;
    readonly applyAction: (
      action: CouncilAction,
    ) => Effect.Effect<CouncilState>;
  }
>()("high-council/CouncilService") {
  static readonly Live = Layer.effect(
    CouncilService,
    Effect.gen(function* () {
      const statusRef = yield* Ref.make<Record<AdvisorId, DecisionStatus>>({
        simplifier: "pending",
        performance: "pending",
        "bug-hunter": "pending",
        architect: "pending",
        "user-voice": "pending",
        contrarian: "pending",
      });

      const clips: Record<string, AudioClip> = JSON.parse(
        readFileSync("public/audio/manifest.json", "utf8"),
      );

      const getState = Effect.fn("CouncilService.getState")(function* () {
        const statuses = yield* Ref.get(statusRef);
        const externalPitchesPath =
          process.env.HIGH_COUNCIL_PITCHES ?? "";
        let externalPitches: Record<string, Record<string, unknown>> = {};
        if (externalPitchesPath && existsSync(externalPitchesPath)) {
          try {
            const parsed = JSON.parse(readFileSync(externalPitchesPath, "utf8"));
            if (Array.isArray(parsed)) {
              for (const item of parsed) {
                const key = item.advisorId ?? item.slug ?? item.id;
                if (typeof key === "string") externalPitches[key] = item;
              }
            } else if (parsed && typeof parsed === "object") {
              externalPitches = parsed.advisors ?? parsed.pitches ?? parsed;
            }
          } catch {}
        }

        return {
          repo: process.env.HIGH_COUNCIL_LABEL ?? "demo/workspace",
          branch: "v2",
          advisors: INITIAL_ADVISORS.map((a) => {
            const ext = externalPitches[a.id];
            return {
              ...a,
              pitchTitle:
                typeof ext?.title === "string"
                  ? ext.title
                  : typeof ext?.pitchTitle === "string"
                    ? ext.pitchTitle
                    : a.pitchTitle,
              evidence: {
                targetFile:
                  typeof ext?.targetFile === "string"
                    ? ext.targetFile
                    : typeof ext?.file === "string"
                      ? ext.file
                      : a.evidence.targetFile,
                refLabel:
                  typeof ext?.refLabel === "string"
                    ? ext.refLabel
                    : a.evidence.refLabel,
                metric:
                  typeof ext?.metric === "string"
                    ? ext.metric
                    : a.evidence.metric,
                diffPreview:
                  typeof ext?.diffPreview === "string"
                    ? ext.diffPreview
                    : typeof ext?.diff === "string"
                      ? ext.diff
                      : a.evidence.diffPreview,
                prPlanSteps: Array.isArray(ext?.prPlanSteps)
                  ? ext.prPlanSteps
                  : Array.isArray(ext?.steps)
                    ? ext.steps
                    : a.evidence.prPlanSteps,
              },
              status: statuses[a.id] ?? "pending",
            };
          }),
          clips,
        };
      });

      const applyAction = Effect.fn("CouncilService.applyAction")(function* (
        action: CouncilAction,
      ) {
        const nextStatus: DecisionStatus = CouncilAction.$match(action, {
          PlanPr: () => "planned" as const,
          DigDeeper: () => "investigating" as const,
          Dismiss: () => "dismissed" as const,
          Reset: () => "pending" as const,
        });

        yield* Ref.update(statusRef, (prev) => ({
          ...prev,
          [action.advisorId]: nextStatus,
        }));

        return yield* getState();
      });

      return CouncilService.of({
        getState,
        applyAction,
      });
    }),
  );
}
