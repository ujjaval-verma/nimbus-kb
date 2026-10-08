import type { ChatEvent, ChatMessage } from "../llm/types";

export interface Turn {
  id: string; question: string; answer: string; status: "streaming" | "done" | "error";
  attemptModelId?: string; failed: string[]; done?: Extract<ChatEvent, { type: "done" }>; error?: string;
}

export function applyEvent(t: Turn, e: ChatEvent): Turn {
  switch (e.type) {
    case "attempt": return { ...t, attemptModelId: e.modelId, answer: "" };
    case "delta": return { ...t, answer: t.answer + e.text };
    case "reset": return { ...t, answer: "", failed: [...t.failed, e.failedModelId] };
    case "done": return { ...t, status: "done", done: e };
    case "error": return { ...t, status: "error", error: e.message };
  }
}

export function totals(turns: Turn[]) {
  return turns.reduce((acc, t) => {
    const u = t.done?.usage;
    if (!u) return acc;
    return { input: acc.input + u.input + u.cacheRead + u.cacheWrite, output: acc.output + u.output, costUsd: acc.costUsd + (t.done?.costUsd ?? 0) };
  }, { input: 0, output: 0, costUsd: 0 });
}

export function historyFor(turns: Turn[], next: string): ChatMessage[] {
  return [...turns.filter((t) => t.status === "done").flatMap((t): ChatMessage[] =>
    [{ role: "user", content: t.question }, { role: "assistant", content: t.answer }]), { role: "user", content: next }];
}
