import { describe, expect, it } from "vitest";
import { planChunks } from "./chunk.js";
import type { PullRequestFile } from "../types/index.js";

const file = (filename: string, patch = "@@ -1 +1 @@\n+code", changes = 4): PullRequestFile => ({
  filename,
  status: "modified",
  additions: changes,
  deletions: 0,
  changes,
  patch,
});

describe("chunking", () => {
  it("filters generated files and prioritizes sensitive files", () => {
    const plan = planChunks([
      file("package-lock.json", "lock".repeat(50), 400),
      file("src/app.ts"),
      file("src/auth/login.ts"),
    ]);
    expect(plan.skippedGenerated.map((item) => item.filename)).toContain("package-lock.json");
    expect(plan.chunks[0]?.files[0]?.filename).toBe("src/auth/login.ts");
  });

  it("respects max file count", () => {
    const files = Array.from({ length: 12 }, (_, index) => file(`src/a${index}.ts`));
    const plan = planChunks(files, { maxFiles: 5 });
    expect(plan.skippedOverflow).toHaveLength(7);
    expect(plan.chunks.reduce((sum, chunk) => sum + chunk.files.length, 0)).toBe(5);
  });

  it("splits large batches", () => {
    const files = [
      file("src/a.ts", "x".repeat(4000)),
      file("src/b.ts", "y".repeat(4000)),
      file("src/c.ts", "z".repeat(4000)),
    ];
    const plan = planChunks(files, { maxChunkChars: 5000, maxPatchChars: 8000 });
    expect(plan.chunks.length).toBeGreaterThan(1);
  });

  it("truncates oversized patches instead of sending entire generated dumps", () => {
    const plan = planChunks([file("src/huge.ts", "a".repeat(250))], { maxPatchChars: 100 });
    expect(plan.chunks[0]?.truncatedFiles).toContain("src/huge.ts");
    expect(plan.chunks[0]?.files[0]?.patch?.length).toBeLessThan(200);
  });
});
