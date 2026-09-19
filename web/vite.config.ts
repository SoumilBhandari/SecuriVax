import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// In dev the API runs separately; in production FastAPI serves this app.
// `npm run dev` expects the backend on :8000; `npm run dev:remote` sets
// API_PROXY to the deployed server, so every page shows real data without
// running the backend.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "API_");
  const api = env.API_PROXY || "http://localhost:8000";
  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: { "/api": { target: api, changeOrigin: true } },
    },
  };
});
