import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    clearMocks: true,
    restoreMocks: true,
  },
  resolve: {
    alias: {
      "@larva-factory/ai-pr-reviewer": path.resolve(
        import.meta.dirname,
        "packages/core/src/index.ts",
      ),
    },
  },
});
