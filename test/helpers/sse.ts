import type { ChatEvent } from "../../src/llm/types";

export async function readEvents(res: Response): Promise<ChatEvent[]> {
  const body = await res.text();
  return body.split("\n\n").map((block) => block.split("\n").find((l) => l.startsWith("data:")))
    .filter((l): l is string => !!l).map((l) => JSON.parse(l.slice(5).trim()) as ChatEvent);
}
