import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: ["src/**"],
      exclude: ["src/index.ts"],
      thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 },
    },
  },
});
