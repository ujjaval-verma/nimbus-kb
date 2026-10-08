import type { ModelConfig } from "./config";
import type { ErrorKind, Notice } from "./types";

const TEXT: Record<ErrorKind, (n: string) => string> = {
  rate_limit: (n) => `${n} is rate limited right now. Try it again in a minute.`,
  quota: (n) => `${n} has hit its provider's usage or billing limit. Pick another model, or ask whoever runs this app to check the account.`,
  auth: (n) => `${n} isn't set up correctly here (missing or invalid credentials). Ask whoever runs this app to check its key or sign-in.`,
  unavailable: (n) => `${n} isn't responding right now. Try again in a moment, or pick another model.`,
  bad_request: (n) => `${n} rejected the request. Try rephrasing the question, or start a new conversation.`,
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
  text: "No AI model could answer. These are the matching passages from the knowledge base, not a composed answer.",
};
// modelName null: the public site's history cap did the trimming, not the model's window.
// After a quota_exhausted notice: the passages are still not a composed answer, but a model was not the problem.
export const PASSAGES_NOTICE: Notice = { kind: "info", text: "These are the matching passages from the knowledge base, not a composed answer." };
export function trimmedNotice(modelName: string | null, dropped: number): Notice {
  const fits = modelName === null ? "the length this public site allows" : `${modelName}'s context window`;
  return { kind: "context", text: `${dropped} earlier message${dropped === 1 ? " was" : "s were"} left out so the conversation fits ${fits}. Start a new conversation for a clean slate.` };
}

export function quotaNotice(reason: "visitor" | "site", limit: number): Notice {
  return { kind: "quota_exhausted", text: reason === "visitor"
    ? `You've used all of today's answers (${limit} a day per visitor). They reset at midnight UTC.`
    : "This demo has used all of today's answers for everyone. They reset at midnight UTC." };
}
export const NO_VISITOR_NOTICE: Notice = {
  kind: "unavailable",
  text: "The AI models are off for this request, so these are the matching passages from the knowledge base.",
};
// The quota counter failed: fail closed.
export const QUOTA_PAUSED_NOTICE: Notice = {
  kind: "unavailable",
  text: "The AI models are paused for a moment, so these are the matching passages from the knowledge base. Try again shortly.",
};
