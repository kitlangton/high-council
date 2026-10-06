import { Schema } from "effect"

// The skin-agnostic content of one briefing. Engines produce it; skins only render it.

export const Priority = Schema.Literals(["urgent", "normal", "fyi"])
export type Priority = typeof Priority.Type

export const DossierItem = Schema.Struct({
  label: Schema.String,
  detail: Schema.String,
  when: Schema.optional(Schema.String),
})
export type DossierItem = typeof DossierItem.Type

export const Decree = Schema.Struct({
  title: Schema.String,
  steps: Schema.Array(Schema.String),
})
export type Decree = typeof Decree.Type

// What a caller's writer returns.
export const Draft = Schema.Struct({
  headline: Schema.String,
  priority: Priority,
  script: Schema.String,
  dossier: Schema.Array(DossierItem),
  decree: Schema.optional(Decree),
})
export type Draft = typeof Draft.Type

export const WordCue = Schema.Struct({ word: Schema.String, s: Schema.Number, e: Schema.Number })
export type WordCue = typeof WordCue.Type

export const Mouth = Schema.Literals(["closed", "open"])
export const MouthCue = Schema.Struct({ s: Schema.Number, e: Schema.Number, m: Mouth })
export type MouthCue = typeof MouthCue.Type

export const Clip = Schema.Struct({
  url: Schema.String,
  duration: Schema.Number,
  words: Schema.Array(WordCue),
  mouth: Schema.Array(MouthCue),
})
export type Clip = typeof Clip.Type

export const CallerCard = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  role: Schema.String,
  frequency: Schema.String,
  portrait: Schema.String,
})
export type CallerCard = typeof CallerCard.Type

export const Transmission = Schema.Struct({
  id: Schema.String,
  caller: CallerCard,
  ...Draft.fields,
  clip: Schema.optional(Clip),
})
export type Transmission = typeof Transmission.Type

export const Briefing = Schema.Struct({
  id: Schema.String,
  date: Schema.String,
  generatedAt: Schema.Number,
  transmissions: Schema.Array(Transmission),
})
export type Briefing = typeof Briefing.Type
