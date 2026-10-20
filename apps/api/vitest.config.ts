import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: { setupFiles: ["./test/setup.ts"], fileParallelism: false, hookTimeout: 30_000, testTimeout: 30_000, environment: "node" },
});
