import type { Section } from "../kb/sections";

export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number }
export const ZERO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export type ErrorKind = "rate_limit" | "quota" | "auth" | "unavailable" | "bad_request";
export class ProviderError extends Error {
  constructor(public kind: ErrorKind, message: string) { super(message); this.name = "ProviderError"; }
}
export interface ChatMessage { role: "user" | "assistant"; content: string }
export interface Passage { id: string; file: string; headingPath: string; docDate: string | null; text: string }
export interface Notice { kind: "fallback" | "unavailable" | "info" | "context"; text: string }
export type ChatEvent =
  | { type: "attempt"; modelId: string }
  | { type: "delta"; text: string }
  | { type: "reset"; failedModelId: string; kind: ErrorKind }
  | { type: "done"; answeredBy: string; usage: Usage; costUsd: number; passages: Passage[]; invalidRefCount: number;
      uncited: boolean;   // a model answer with no valid citation that is not the E2 line: UI shows "No sources cited"
      contextTokens: number;   // estimated window fill after this turn; 0 for sources-only
      notices: Notice[] }
  | { type: "error"; message: string };
export const NOT_COVERED = "That isn't covered in the NimbusStack knowledge base.";
export function toPassage(s: Section): Passage {
  return { id: s.id, file: s.file, headingPath: s.headingPath, docDate: s.docDate, text: s.text };
}
