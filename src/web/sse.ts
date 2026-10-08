import type { ChatEvent } from "../llm/types";

export function parseSSE(chunk: string, carry: string): { events: ChatEvent[]; carry: string } {
  const buf = carry + chunk;
  const blocks = buf.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events = blocks.map((b) => b.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join(""))
    .filter(Boolean).map((d) => JSON.parse(d) as ChatEvent);
  return { events, carry: rest };
}
