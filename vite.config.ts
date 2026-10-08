import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

// The Worker must never pick up local dev keys from .env; .dev.vars is still read.
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "false";

export default defineConfig(({ command, mode }) => {
  const useWorker = command === "build" || mode === "worker";
  return {
    plugins: [react(), ...(useWorker ? [cloudflare()] : [])],
    server: useWorker
      ? undefined
      : { proxy: { "/api": { target: "http://127.0.0.1:8787", changeOrigin: true } } },
  };
});
