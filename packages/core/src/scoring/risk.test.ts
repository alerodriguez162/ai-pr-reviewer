import { describe, expect, it } from "vitest";
import { calculateRiskScore, riskLevelFromScore, applyRecommendationGuardrails } from "./risk.js";
import type { PullRequestFile, ReviewFinding } from "../types/index.js";

const file = (filename: string): PullRequestFile => ({
  filename,
  status: "modified",
  additions: 10,
  deletions: 2,
  changes: 12,
});

const finding = (overrides: Partial<ReviewFinding>): ReviewFinding => ({
  id: "f",
  category: "bug",
  severity: "low",
  confidence: "high",
  title: "t",
  description: "d",
  ...overrides,
});

describe("risk score", () => {
  it("is deterministic and not random", () => {
    const input = {
      findings: [finding({ severity: "medium" })],
      files: [file("src/app.ts")],
      additions: 10,
      deletions: 2,
    };
    expect(calculateRiskScore(input)).toBe(calculateRiskScore(input));
  });

  it("weights critical findings more than medium", () => {
    const base = { files: [file("src/app.ts")], additions: 10, deletions: 2 };
    const critical = calculateRiskScore({
      ...base,
      findings: [finding({ severity: "critical", category: "security" })],
    });
    const medium = calculateRiskScore({
      ...base,
      findings: [finding({ severity: "medium" })],
    });
    expect(critical).toBeLessThan(medium);
  });

  it("penalizes sensitive files and missing tests", () => {
    const withTests = calculateRiskScore({
      findings: [],
      files: [file("src/app.ts"), file("src/app.test.ts")],
      additions: 10,
      deletions: 2,
    });
    const missingTests = calculateRiskScore({
      findings: [],
      files: [file("src/auth/login.ts")],
      additions: 10,
      deletions: 2,
    });
    expect(missingTests).toBeLessThan(withTests);
  });

  it("maps score bands to risk levels", () => {
    expect(riskLevelFromScore(95)).toBe("low");
    expect(riskLevelFromScore(70)).toBe("medium");
    expect(riskLevelFromScore(50)).toBe("high");
    expect(riskLevelFromScore(10)).toBe("critical");
  });
});

describe("recommendation guardrails", () => {
  it("requests changes for critical findings", () => {
    expect(
      applyRecommendationGuardrails({
        findings: [finding({ severity: "critical", confidence: "high" })],
        files: [file("src/app.ts")],
        insufficientContext: false,
        aiRecommendation: "approve",
      }),
    ).toBe("request_changes");
  });

  it("requires manual review for high-severity low-confidence findings", () => {
    expect(
      applyRecommendationGuardrails({
        findings: [finding({ severity: "high", confidence: "low" })],
        files: [file("src/auth/login.ts")],
        insufficientContext: false,
      }),
    ).toBe("manual_review_required");
  });

  it("approves when there are no meaningful findings", () => {
    expect(
      applyRecommendationGuardrails({
        findings: [],
        files: [file("src/app.ts")],
        insufficientContext: false,
      }),
    ).toBe("approve");
  });
});
