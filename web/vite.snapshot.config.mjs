// One-file build of the whole app for a snapshot (see backend/scripts/snapshot_app.py):
// relative asset paths, one JS bundle (no lazy chunks), assets inlined.
import { defineConfig, mergeConfig } from "vite";

import base from "./vite.config.ts";

export default mergeConfig(
  base,
  defineConfig({
    base: "./",
    build: {
      outDir: "dist-snapshot",
      emptyOutDir: true,
      assetsInlineLimit: 100_000_000,
      cssCodeSplit: false,
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  }),
);
