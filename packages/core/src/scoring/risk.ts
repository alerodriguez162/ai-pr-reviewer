import type {
  PullRequestFile,
  PullRequestReview,
  Recommendation,
  ReviewFinding,
  RiskLevel,
  Severity,
} from "../types/index.js";
import { isTestFile } from "../security/generated.js";
import { uniqueSensitiveAreas } from "../security/sensitive.js";

/**
 * Deterministic risk score (0-100, higher is better).
 *
 * Start at 100 and subtract:
 * - critical finding: 25
 * - high finding: 12
 * - medium finding: 6
 * - low finding: 2
 * - info: 0
 * - extra 8 per security finding (any severity except info)
 * - 4 per sensitive area (max 16)
 * - 8 when production files changed without test files
 * - 5 when additions+deletions > 500, extra 5 when > 1500
 * - 4 when a high/critical finding has only low confidence (uncertainty penalty,
 *   but recommendation guardrails will force manual review)
 *
 * The LLM never chooses the published score.
 */
export function calculateRiskScore(input: {
  findings: ReviewFinding[];
  files: PullRequestFile[];
  additions: number;
  deletions: number;
}): number {
  let score = 100;
  const weights: Record<Severity, number> = {
    critical: 25,
    high: 12,
    medium: 6,
    low: 2,
    info: 0,
  };

  for (const finding of input.findings) {
    score -= weights[finding.severity];
    if (finding.category === "security" && finding.severity !== "info") {
      score -= 8;
    }
    if (
      (finding.severity === "high" || finding.severity === "critical") &&
      finding.confidence === "low"
    ) {
      score -= 4;
    }
  }

  const sensitiveAreas = uniqueSensitiveAreas(input.files.map((file) => file.filename));
  score -= Math.min(16, sensitiveAreas.length * 4);

  const productionChanged = input.files.some(
    (file) => !isTestFile(file.filename) && !file.filename.endsWith(".md"),
  );
  const testsChanged = input.files.some((file) => isTestFile(file.filename));
  if (productionChanged && !testsChanged) {
    score -= 8;
  }

  const churn = input.additions + input.deletions;
  if (churn > 1500) {
    score -= 10;
  } else if (churn > 500) {
    score -= 5;
  }

  return clampScore(score);
}

export function riskLevelFromScore(score: number): RiskLevel {
  if (score >= 75) {
    return "low";
  }
  if (score >= 60) {
    return "medium";
  }
  if (score >= 40) {
    return "high";
  }
  return "critical";
}

export function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function applyRecommendationGuardrails(input: {
  findings: ReviewFinding[];
  files: PullRequestFile[];
  insufficientContext: boolean;
  aiRecommendation?: Recommendation;
}): Recommendation {
  const critical = input.findings.filter((finding) => finding.severity === "critical");
  const highConfident = input.findings.filter(
    (finding) =>
      finding.severity === "high" &&
      (finding.confidence === "medium" || finding.confidence === "high"),
  );
  const highLowConfidence = input.findings.filter(
    (finding) => finding.severity === "high" && finding.confidence === "low",
  );
  const sensitive = uniqueSensitiveAreas(input.files.map((file) => file.filename)).length > 0;

  if (critical.length > 0) {
    return "request_changes";
  }
  if (highConfident.length >= 2) {
    return "request_changes";
  }
  if (highConfident.length === 1 && highConfident[0]?.category === "security") {
    return "request_changes";
  }
  if (input.insufficientContext && sensitive) {
    return "manual_review_required";
  }
  if (highLowConfidence.length > 0) {
    return "manual_review_required";
  }

  const meaningful = input.findings.filter((finding) => finding.severity !== "info");
  if (meaningful.length === 0) {
    return "approve";
  }
  const onlyLow = meaningful.every((finding) => finding.severity === "low");
  if (onlyLow) {
    return "approve_with_suggestions";
  }

  if (input.aiRecommendation === "request_changes" && highConfident.length === 0) {
    return "approve_with_suggestions";
  }

  return input.aiRecommendation ?? "approve_with_suggestions";
}

export function scoreReview(
  review: Omit<PullRequestReview, "score" | "riskLevel" | "recommendation"> & {
    recommendation?: Recommendation;
    insufficientContext?: boolean;
    files: PullRequestFile[];
  },
): Pick<PullRequestReview, "score" | "riskLevel" | "recommendation"> {
  const score = calculateRiskScore({
    findings: review.findings,
    files: review.files,
    additions: review.statistics.additions,
    deletions: review.statistics.deletions,
  });
  return {
    score,
    riskLevel: riskLevelFromScore(score),
    recommendation: applyRecommendationGuardrails({
      findings: review.findings,
      files: review.files,
      insufficientContext: review.insufficientContext ?? false,
      aiRecommendation: review.recommendation,
    }),
  };
}
