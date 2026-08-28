import { describe, expect, it } from "vitest";
import { aiChunkReviewSchema } from "./review.js";
import { parseAndValidateChunkReview, repairLoop } from "../ai/validate.js";

const valid = {
  summary: "Looks mostly fine.",
  findings: [
    {
      category: "bug",
      severity: "medium",
      confidence: "high",
      title: "Null check missing",
      description: "The new branch does not handle a missing user.",
      file: "src/api/users.ts",
      line: 84,
    },
  ],
  positiveObservations: ["Clear function names"],
  testingAssessment: {
    testsDetected: true,
    coverageConcerns: ["unauthorized user"],
    suggestedTests: ["reject missing user"],
  },
  sensitiveAreas: ["api-routes"],
  manualReviewAreas: [],
  recommendation: "approve_with_suggestions",
  insufficientContext: false,
};

describe("AI schema validation", () => {
  it("accepts a structured review", () => {
    expect(aiChunkReviewSchema.parse(valid).findings).toHaveLength(1);
  });

  it("rejects malformed AI output", () => {
    const parsed = parseAndValidateChunkReview('{"summary": 12}');
    expect(parsed.success).toBe(false);
  });

  it("parses fenced JSON", () => {
    const parsed = parseAndValidateChunkReview(`\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``);
    expect(parsed.success).toBe(true);
  });

  it("retries then accepts a repaired payload", () => {
    const result = repairLoop(
      [
        () => parseAndValidateChunkReview("not json"),
        () => parseAndValidateChunkReview(JSON.stringify(valid)),
      ],
      2,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.retries).toBe(1);
    }
  });

  it("stops after the retry limit", () => {
    const result = repairLoop(
      [
        () => parseAndValidateChunkReview("nope"),
        () => parseAndValidateChunkReview("still nope"),
        () => parseAndValidateChunkReview(JSON.stringify(valid)),
      ],
      1,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retries).toBe(1);
    }
  });
});
