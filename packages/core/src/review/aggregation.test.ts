import { describe, expect, it } from "vitest";
import { dedupeFindings, normalizeFinding } from "./aggregation.js";
import type { ReviewFinding } from "../types/index.js";

const finding = (overrides: Partial<ReviewFinding>): ReviewFinding => ({
  id: "x",
  category: "bug",
  severity: "low",
  confidence: "medium",
  title: "Null check",
  description: "desc",
  file: "src/a.ts",
  ...overrides,
});

describe("finding aggregation", () => {
  it("normalizes whitespace and generates ids", () => {
    const normalized = normalizeFinding(
      finding({ id: "  ", title: "  Hello  ", description: "  body  " }),
      0,
    );
    expect(normalized.title).toBe("Hello");
    expect(normalized.id.startsWith("finding-")).toBe(true);
  });

  it("deduplicates by category, file, and title keeping higher severity", () => {
    const result = dedupeFindings([
      finding({ severity: "low", title: "Null check" }),
      finding({ severity: "high", title: "Null check" }),
      finding({ severity: "medium", title: "Other", file: "src/b.ts" }),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]?.severity).toBe("high");
  });
});
