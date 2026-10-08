// Local development only. Uses the developer's Claude Code login through the Claude Agent SDK.
// Never imported by the Worker entry (scripts/check-bundles.ts enforces this).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { type Adapter, type AdapterChunk, type ChatMessage, type ErrorKind, ProviderError } from "./types";

export function mapSdkError(code: string | undefined): ErrorKind {
  switch (code) {
    case "authentication_failed": case "oauth_org_not_allowed": case "account_on_hold":
    case "verification_required": case "cloud_credential_error": return "auth";
    case "billing_error": return "quota";
    case "rate_limit": return "rate_limit";
    case "invalid_request": case "model_not_found": case "max_output_tokens": return "bad_request";
    default: return "unavailable";
  }
}

// query() takes one prompt string, so turns are wrapped in tags. Escaping "<" stops a user from closing a tag
// in their own text and faking an assistant turn. (claude-api.ts sends real message roles and needs none of this.)
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

export function flattenHistory(messages: ChatMessage[]): string {
  const question = `<current_question>\n${esc(messages[messages.length - 1].content)}\n</current_question>`;
  if (messages.length === 1) return question;
  const prior = messages.slice(0, -1).map((m) => `<${m.role}>\n${esc(m.content)}\n</${m.role}>`).join("\n");
  return `<conversation>\n${prior}\n</conversation>\n\n${question}`;
}

// Subscription logins report "oauth" (or "none"); every other ApiKeySource in sdk.d.ts means a key-based login.
const SUBSCRIPTION_KEY_SOURCES = new Set(["none", "oauth"]);
// Credentials and endpoints that would send the call to the metered API instead of the subscription.
// That includes Bedrock, Vertex and Foundry routing, which would bill the developer's cloud account.
const BILLING_ENV = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY", "AWS_BEARER_TOKEN_BEDROCK", "ANTHROPIC_BEDROCK_BASE_URL", "ANTHROPIC_VERTEX_PROJECT_ID"];

export function createClaudeSubAdapter(opts: { query?: typeof sdkQuery; cwd?: string } = {}): Adapter {
  const query = opts.query ?? sdkQuery;
  const cwd = opts.cwd ?? mkdtempSync(join(tmpdir(), "nimbus-kb-"));   // empty dir: nothing to read
  return {
    name: "claude-sub", tested: true,
    async *stream(req): AsyncIterable<AdapterChunk> {
      const abortController = new AbortController();
      if (req.signal.aborted) abortController.abort();
      else req.signal.addEventListener("abort", () => abortController.abort(), { once: true });
      const env: Record<string, string | undefined> = { ...process.env, ENABLE_CLAUDEAI_MCP_SERVERS: "false" };
      for (const k of BILLING_ENV) delete env[k];
      let messages: AsyncIterable<unknown>;
      try {
        messages = query({
          prompt: flattenHistory(req.messages),
          options: {
            model: req.model.model, systemPrompt: req.system, tools: [], mcpServers: {}, strictMcpConfig: true, maxTurns: 1, cwd,
            settingSources: [], persistSession: false, includePartialMessages: true, abortController,
            // A claude.ai login also brings the account's claude.ai connectors (Slack, Drive...), which settingSources
            // does not cover. `env` replaces the whole environment, so it starts from process.env minus
            // API-key variables, which would bill the API instead of the subscription.
            env,
            ...(req.model.effort ? { effort: req.model.effort } : {}),
          },
        });
      } catch (err) { throw new ProviderError("unavailable", String(err)); }
      try {
        for await (const raw of messages) {
          const m = raw as { type: string; event?: { type: string; delta?: { type: string; text?: string } };
            error?: string; apiKeySource?: string; subtype?: string; is_error?: boolean; tools?: string[]; mcp_servers?: unknown[];
            usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } };
          if (m.type === "system" && m.subtype === "init") {
            // Fail closed: an init message that does not say where the credentials came from is not trusted.
            if (m.apiKeySource === undefined || !SUBSCRIPTION_KEY_SOURCES.has(m.apiKeySource)) {
              abortController.abort();
              throw new ProviderError("auth", `Claude Agent SDK is not on a subscription login (apiKeySource: ${m.apiKeySource ?? "missing"})`);
            }
            // Belt and braces: the options above disable tools, MCP and local settings. If the SDK still loaded any
            // (e.g. from the developer's global config), refuse rather than give the model capabilities.
            if ((m.tools?.length ?? 0) > 0 || (m.mcp_servers?.length ?? 0) > 0) {
              abortController.abort();
              throw new ProviderError("bad_request", `Claude Agent SDK loaded tools or MCP servers: ${JSON.stringify({ tools: m.tools, mcp: m.mcp_servers })}`);
            }
          } else if (m.type === "stream_event" && m.event?.type === "content_block_delta" && m.event.delta?.type === "text_delta") {
            yield { type: "delta", text: m.event.delta.text ?? "" };
          } else if (m.type === "assistant" && m.error) {
            throw new ProviderError(mapSdkError(m.error), `Claude Agent SDK: ${m.error}`);
          } else if (m.type === "result") {
            if (m.subtype !== "success" || m.is_error) throw new ProviderError("unavailable", `Claude Agent SDK result: ${m.subtype}`);
            const u = m.usage ?? {};
            yield { type: "usage", usage: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0,
              cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 } };
          }
        }
      } catch (err) {
        if (err instanceof ProviderError) throw err;
        throw new ProviderError("unavailable", String(err));
      }
    },
  };
}
