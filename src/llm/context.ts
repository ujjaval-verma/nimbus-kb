import type { ModelConfig } from "./config";
import type { ChatMessage } from "./types";

// Deliberately conservative. Measured on this knowledge base's system prompt (15,579 characters): Claude Sonnet counted
// 6,369 tokens (2.45 characters per token) and Gemini 4,679 (3.3). The prompt is tables, ids and markdown, which
// tokenize far worse than prose (about 4 characters per token), so a plain 3 would undercount Claude. At 2 the
// estimate (7,790) overcounts Claude by about 22% and Gemini by more.
export const CHARS_PER_TOKEN = 2;
// Longest reply we ask for. claude-api.ts sends it as max_tokens; gemini.ts as maxOutputTokens, where it also has to
// cover Gemini's thinking tokens.
export const MAX_OUTPUT_TOKENS = 16_000;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// Trimming starts at 95% of the window in estimate units, the same units the UI meter uses, so the meter's amber (75%)
// and red (90%) always come before any turn is dropped. No separate reply allowance is needed: the estimate overcounts
// Claude's real tokens on this content by about 22% (more for prose), which leaves more than MAX_OUTPUT_TOKENS of real
// room in every implemented window.
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

// The public site's byte budget is its own cost bound, separate from the estimate above: UTF-8 bytes / 3, plus a
// per-message overhead, against PUBLIC_HISTORY_TOKENS (so at most 60,000 bytes). It does not follow CHARS_PER_TOKEN.
export const PUBLIC_BYTES_PER_UNIT = 3;

// The window the UI meter should use when history is capped (public site): trimming then starts at exactly TRIM_AT of
// it, the same place it starts for an uncapped model, so amber (75%) and red (90%) still come first. The meter counts
// in estimate units (CHARS_PER_TOKEN), so the byte budget is converted into them first.
export function publicContextWindow(systemTokens: number, historyTokens: number): number {
  return Math.ceil((systemTokens + (historyTokens * PUBLIC_BYTES_PER_UNIT) / CHARS_PER_TOKEN) / TRIM_AT);
}

// The public site's history bound. estimateTokens counts UTF-16 units, so text that is several bytes per unit (CJK,
// emoji, combining marks) or many tiny messages could carry far more real tokens than it counts. Provider tokenizers
// are byte-level (at most one token per UTF-8 byte), so the public path measures bytes: bytes / 3 plus a per-message
// overhead, against PUBLIC_HISTORY_TOKENS, with a cap on the number of messages. The real-token ceiling is then
// 3 x PUBLIC_HISTORY_TOKENS whatever the text is.
export const PUBLIC_MESSAGE_OVERHEAD = 4;
const utf8 = new TextEncoder();
export function publicTokens(text: string): number {
  return Math.ceil(utf8.encode(text).length / PUBLIC_BYTES_PER_UNIT) + PUBLIC_MESSAGE_OVERHEAD;
}

// Empty or whitespace-only turns carry nothing, and an empty assistant turn is an API error. Drop each with its other
// half (an empty answer with its question, an empty question with its answer) so roles keep alternating.
function dropEmptyTurns(messages: ChatMessage[]): ChatMessage[] {
  const keep = messages.map(() => true);
  messages.forEach((m, i) => {
    if (m.content.trim() !== "") return;
    keep[i] = false;
    if (m.role === "assistant" && messages[i - 1]?.role === "user") keep[i - 1] = false;
    if (m.role === "user" && messages[i + 1]?.role === "assistant") keep[i + 1] = false;
  });
  const out = messages.filter((_, i) => keep[i]);
  return out.filter((m, i) => out[i + 1]?.role !== m.role);   // any leftover run of one role: keep its last message
}

// Public path only. Same contract as fitToWindow: newest first, the current question always kept, starts on a user
// turn. `dropped` counts only messages trimmed for size or count (empty turns are not news to the user).
export function fitPublic(messages: ChatMessage[], budgetTokens: number, maxMessages: number): { messages: ChatMessage[]; dropped: number } {
  const clean = dropEmptyTurns(messages);
  const out: ChatMessage[] = [];
  let used = 0;
  for (let i = clean.length - 1; i >= 0; i--) {
    used += publicTokens(clean[i].content);
    if ((used > budgetTokens || out.length >= maxMessages) && out.length > 0) break;
    out.unshift(clean[i]);
  }
  while (out.length > 1 && out[0].role !== "user") out.shift();
  return { messages: out, dropped: clean.length - out.length };
}
