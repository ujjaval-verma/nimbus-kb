import { defineConfig } from "vitest/config";
// Vitest does not read vite.config.ts here, so set the JSX runtime explicitly for the .tsx tests.
// (If the installed Vitest transforms with oxc instead of esbuild, use `oxc: { jsx: { runtime: "automatic" } }`.)
export default defineConfig({ esbuild: { jsx: "automatic" }, test: { environment: "node", include: ["test/**/*.test.{ts,tsx}"], setupFiles: ["test/setup/no-network.ts"] } });
