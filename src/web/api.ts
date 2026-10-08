import type { ModelConfig } from "../llm/config";
import type { ChatEvent, ChatMessage } from "../llm/types";
import { parseSSE } from "./sse";

export interface ModelInfo extends ModelConfig { available: boolean; tested: boolean }
export interface ModelsResponse { fallbackOrder: string[]; contextWarning: { amber: number; red: number }; systemPromptTokens: number; models: ModelInfo[];
  contextCap: number | null;   // public site: history is capped, and the meter measures against this window
  quota: { limit: number; remaining: number } | null }

export async function fetchModels(): Promise<ModelsResponse> {
  const r = await fetch("/api/models");
  if (!r.ok) throw new Error("Couldn't load the model list.");
  return r.json();
}

export async function streamChat(body: { modelId: string; messages: ChatMessage[] }, onEvent: (e: ChatEvent) => void, signal: AbortSignal): Promise<void> {
  const r = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (!r.ok || !r.body) {
    const msg = (await r.json().catch(() => null))?.error ?? "Something went wrong on our side. Please try again.";
    onEvent({ type: "error", message: msg });
    return;
  }
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let carry = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const parsed = parseSSE(value, carry);
      carry = parsed.carry;
      parsed.events.forEach(onEvent);
    }
  } finally {
    reader.cancel().catch(() => {});   // a failed or abandoned stream must not keep the request open
  }
}
