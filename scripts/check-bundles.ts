import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : [p]; });
}
const read = (dir: string) => files(dir).filter((f) => /\.(m?js|html|css|json|map)$/.test(f)).map((f) => ({ f, s: readFileSync(f, "utf8") }));
const fail: string[] = [];

for (const { f, s } of read("dist/client")) {
  if (/sk-ant-[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{35}/.test(s)) fail.push(`${f}: key-shaped string in client bundle`);
  if (/ANTHROPIC_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY|QUOTA_SALT|SITE_PASSWORD/.test(s)) fail.push(`${f}: key env name in client bundle`);
  if (/claude-agent-sdk/.test(s)) fail.push(`${f}: agent sdk in client bundle`);
}
const workerDirs = readdirSync("dist").filter((d) => d !== "client" && statSync(join("dist", d)).isDirectory());
if (workerDirs.length === 0) fail.push("no worker build output found in dist/");
for (const dir of workerDirs) for (const { f, s } of read(join("dist", dir))) {
  if (/claude-agent-sdk|createClaudeSubAdapter/.test(s)) fail.push(`${f}: subscription adapter in Worker bundle`);
}
if (fail.length) { console.error(fail.join("\n")); process.exit(1); }
console.log("bundle checks passed");
