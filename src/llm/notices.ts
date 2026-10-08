import type { ModelConfig } from "./config";
import type { ErrorKind, Notice } from "./types";

const TEXT: Record<ErrorKind, (n: string) => string> = {
  rate_limit: (n) => `${n} is rate limited right now. Try it again in a minute.`,
  quota: (n) => `${n} has used up its quota or plan limit. Pick another model, or ask whoever runs this app to check the plan.`,
  auth: (n) => `${n} isn't set up correctly here (missing or invalid credentials). Ask whoever runs this app to check its key or sign-in.`,
  unavailable: (n) => `${n} isn't responding right now. Try again in a moment, or pick another model.`,
  bad_request: (n) => `${n} rejected the request. Try rephrasing the question, or start a new chat.`,
};
export function noticeFor(modelName: string, kind: ErrorKind): Notice {
  return { kind: "fallback", text: TEXT[kind](modelName) };
}
export function skippedNotice(m: ModelConfig): Notice {
  return m.status === "placeholder"
    ? { kind: "unavailable", text: `${m.name} is a placeholder in this build and can't answer yet.` }
    : { kind: "unavailable", text: `${m.name} isn't configured on this deployment.` };
}
export const SOURCES_ONLY_NOTICE: Notice = {
  kind: "info",
  text: "No AI model could answer, so these passages from the knowledge base may be relevant. They are not a checked answer.",
};
