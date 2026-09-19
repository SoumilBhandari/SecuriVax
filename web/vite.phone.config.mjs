// Dev server for testing on a phone over Wi-Fi, with HTTPS so the live camera
// works. Run: npm run dev:phone (makes the certificate first).
import fs from "node:fs";

import { defineConfig, mergeConfig } from "vite";

import base from "./vite.config.ts";

export default mergeConfig(
  base,
  defineConfig({
    server: {
      host: true,
      https: { key: fs.readFileSync(".cert/dev.key"), cert: fs.readFileSync(".cert/dev.crt") },
    },
  }),
);
