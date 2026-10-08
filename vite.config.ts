import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig(({ command, mode }) => {
  const useWorker = command === "build" || mode === "worker";
  return {
    plugins: [react(), ...(useWorker ? [cloudflare()] : [])],
    server: useWorker
      ? undefined
      : { proxy: { "/api": { target: "http://127.0.0.1:8787", changeOrigin: true } } },
  };
});
