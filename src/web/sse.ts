import type { ChatEvent } from "../llm/types";

export function parseSSE(chunk: string, carry: string): { events: ChatEvent[]; carry: string } {
  const buf = carry + chunk;
  const blocks = buf.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events: ChatEvent[] = [];
  for (const b of blocks) {
    const d = b.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
    if (!d) continue;
    try { events.push(JSON.parse(d) as ChatEvent); } catch { /* skip a malformed block */ }
  }
  return { events, carry: rest };
}
