import type { ModelConfig } from "./config";
import type { ChatMessage } from "./types";

// Deliberately conservative: English prose averages about 4 characters per token, so 3 overestimates.
export const CHARS_PER_TOKEN = 3;
// Longest reply we ask for. claude-api.ts sends it as max_tokens; gemini.ts as maxOutputTokens, where it also has to
// cover Gemini's thinking tokens.
export const MAX_OUTPUT_TOKENS = 16_000;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// Trimming starts at 95% of the window in estimate units, the same units the UI meter uses, so the meter's amber (75%)
// and red (90%) always come before any turn is dropped. No separate reply allowance is needed: the estimate overcounts
// English by about a third, which leaves far more than MAX_OUTPUT_TOKENS of real room in every implemented window.
export const TRIM_AT = 0.95;
export function historyBudget(model: ModelConfig, systemTokens: number): number {
  return Math.floor(model.contextWindow * TRIM_AT) - systemTokens;
}

export function fitToWindow(messages: ChatMessage[], budgetTokens: number): { messages: ChatMessage[]; dropped: number } {
  const out: ChatMessage[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    used += estimateTokens(messages[i].content);
    if (used > budgetTokens && out.length > 0) break;   // the current question is always kept
    out.unshift(messages[i]);
  }
  while (out.length > 1 && out[0].role !== "user") out.shift();
  return { messages: out, dropped: messages.length - out.length };
}
