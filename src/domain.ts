import { Data, Schema } from "effect";

export const AdvisorId = Schema.Literals([
  "simplifier",
  "performance",
  "bug-hunter",
  "architect",
  "user-voice",
  "contrarian",
]);
export type AdvisorId = typeof AdvisorId.Type;

export const Expression = Schema.Literals([
  "neutral",
  "excited",
  "worried",
  "smug",
  "annoyed",
]);
export type Expression = typeof Expression.Type;

export const Viseme = Schema.Literals([
  "closed",
  "open",
  "wide",
  "round",
  "fv",
]);
export type Viseme = typeof Viseme.Type;

export const DecisionStatus = Schema.Literals([
  "pending",
  "planned",
  "investigating",
  "dismissed",
]);
export type DecisionStatus = typeof DecisionStatus.Type;

export interface VisemeCue {
  readonly t: number;
  readonly e: number;
  readonly v: Viseme;
}
export const VisemeCue = Schema.Struct({
  t: Schema.Number,
  e: Schema.Number,
  v: Viseme,
});

export interface WordCue {
  readonly word: string;
  readonly s: number;
  readonly e: number;
}
export const WordCue = Schema.Struct({
  word: Schema.String,
  s: Schema.Number,
  e: Schema.Number,
});

export interface AudioClip {
  readonly id: string;
  readonly advisorId: AdvisorId;
  readonly text: string;
  readonly audioUrl: string;
  readonly duration: number;
  readonly visemes: ReadonlyArray<VisemeCue>;
  readonly words: ReadonlyArray<WordCue>;
}
export const AudioClip = Schema.Struct({
  id: Schema.String,
  advisorId: AdvisorId,
  text: Schema.String,
  audioUrl: Schema.String,
  duration: Schema.Number,
  visemes: Schema.Array(VisemeCue),
  words: Schema.Array(WordCue),
});

export interface Interjection {
  readonly advisorId: AdvisorId;
  readonly clipId: string;
  readonly expression: Expression;
  readonly targetExpression: Expression;
}
export const Interjection = Schema.Struct({
  advisorId: AdvisorId,
  clipId: Schema.String,
  expression: Expression,
  targetExpression: Expression,
});

export interface PitchEvidence {
  readonly targetFile: string;
  readonly refLabel: string;
  readonly metric: string;
  readonly diffPreview: string;
  readonly prPlanSteps: ReadonlyArray<string>;
}
export const PitchEvidence = Schema.Struct({
  targetFile: Schema.String,
  refLabel: Schema.String,
  metric: Schema.String,
  diffPreview: Schema.String,
  prPlanSteps: Schema.Array(Schema.String),
});

export interface Advisor {
  readonly id: AdvisorId;
  readonly name: string;
  readonly icon: string;
  readonly accent: string;
  readonly pitchClipId: string;
  readonly pitchTitle: string;
  readonly pitchExpression: Expression;
  readonly councilReactions: Readonly<Record<AdvisorId, Expression>>;
  readonly interjections: ReadonlyArray<Interjection>;
  readonly evidence: PitchEvidence;
  readonly status: DecisionStatus;
}

export type CouncilAction = Data.TaggedEnum<{
  PlanPr: { readonly advisorId: AdvisorId };
  DigDeeper: { readonly advisorId: AdvisorId };
  Dismiss: { readonly advisorId: AdvisorId };
  Reset: { readonly advisorId: AdvisorId };
}>;
export const CouncilAction = Data.taggedEnum<CouncilAction>();

export const DecisionRequest = Schema.Struct({
  advisorId: AdvisorId,
  action: Schema.Literals(["plan", "dig", "dismiss", "reset"]),
});
export type DecisionRequest = typeof DecisionRequest.Type;
