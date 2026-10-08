export type AnthropicChoice = "api" | "subscription" | "none";

// Local dev defaults to the free subscription. The paid API key is used only on an explicit ANTHROPIC_DEV_API=1,
// so a key loaded into the shell (direnv) never spends money silently.
export function selectAnthropic(env: Record<string, string | undefined>): AnthropicChoice {
  if (env.ANTHROPIC_DEV_API === "1" && env.ANTHROPIC_API_KEY) return "api";
  return env.CLAUDE_SUBSCRIPTION === "0" ? "none" : "subscription";
}
