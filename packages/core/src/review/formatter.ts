import type { PullRequestReview, Recommendation, RiskLevel, ReviewFinding, Severity } from "../types/index.js";

const SEVERITY_ICON: Record<Severity, string> = {
  critical: "⛔",
  high: "🔴",
  medium: "🟠",
  low: "🟡",
  info: "🔵",
};

const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  approve: "APPROVE",
  approve_with_suggestions: "APPROVE WITH SUGGESTIONS",
  request_changes: "REQUEST CHANGES",
  manual_review_required: "MANUAL REVIEW REQUIRED",
};

const RISK_LABEL: Record<RiskLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export function formatReviewMarkdown(review: PullRequestReview): string {
  const findings =
    review.findings.length === 0
      ? "_No findings._"
      : review.findings.map(formatFinding).join("\n\n---\n\n");

  const testingConcerns =
    review.testingAssessment.coverageConcerns.length > 0
      ? review.testingAssessment.coverageConcerns.map((item) => `- ${item}`).join("\n")
      : "_None noted._";

  const suggestedTests =
    review.testingAssessment.suggestedTests.length > 0
      ? review.testingAssessment.suggestedTests.map((item) => `- ${item}`).join("\n")
      : "_None._";

  const sensitive =
    review.sensitiveAreas.length > 0
      ? review.sensitiveAreas.map((item) => `- ${item}`).join("\n")
      : "_None detected._";

  const manual =
    review.manualReviewAreas.length > 0
      ? review.manualReviewAreas.map((item) => `- ${item}`).join("\n")
      : "_None._";

  const positives =
    review.positiveObservations.length > 0
      ? review.positiveObservations.map((item) => `- ${item}`).join("\n")
      : "_None._";

  return `# AI Pull Request Review

**Score:** ${review.score}/100
**Risk:** ${RISK_LABEL[review.riskLevel]}

**Recommendation:**
${RECOMMENDATION_LABEL[review.recommendation]}

## Summary

${review.summary}

## Statistics

- Files changed: ${review.statistics.filesChanged}
- Additions: ${review.statistics.additions}
- Deletions: ${review.statistics.deletions}

## Findings

${findings}

## Positive observations

${positives}

## Testing

Tests detected: ${review.testingAssessment.testsDetected ? "Yes" : "No"}

Potential missing coverage:

${testingConcerns}

Suggested tests:

${suggestedTests}

## Sensitive Areas

${sensitive}

## Manual Review Recommended

${manual}

---
AI-generated review. Verify important findings manually.
`;
}

function formatFinding(finding: ReviewFinding): string {
  const location = finding.file
    ? finding.line
      ? `${finding.file}:${finding.line}`
      : finding.file
    : "general";

  return `${SEVERITY_ICON[finding.severity]} **${finding.severity.toUpperCase()}** — ${finding.title}

${location}

${finding.description}

Confidence: ${capitalize(finding.confidence)}
${finding.suggestion ? `\nSuggested action:\n${finding.suggestion}` : ""}`;
}

export function formatReviewPretty(review: PullRequestReview): string {
  return formatReviewMarkdown(review);
}

export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
