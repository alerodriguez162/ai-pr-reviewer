import type { ReviewFinding } from "../types/index.js";

const WORKFLOW_PATH = /^\.github\/workflows\//;

/**
 * GitHub Actions workflows reference `${{ secrets.* }}` by design.
 * Flagging that pattern as "secret exposure" is a recurring false positive.
 */
export function isWorkflowSecretsFalsePositive(finding: ReviewFinding): boolean {
  if (finding.category !== "security" || !finding.file || !WORKFLOW_PATH.test(finding.file)) {
    return false;
  }

  const text = `${finding.title} ${finding.description} ${finding.suggestion ?? ""}`.toLowerCase();
  const aboutSecrets =
    text.includes("secret") ||
    text.includes("openai_api_key") ||
    text.includes("api key") ||
    text.includes("ci/cd");

  if (!aboutSecrets) {
    return false;
  }

  const realExposure =
    /hardcod|plaintext|committed to|in source|echo|print|log.*secret|exposed in (the )?(repo|code|file)/i.test(
      text,
    );

  return !realExposure;
}

export function filterKnownFalsePositives(findings: ReviewFinding[]): {
  findings: ReviewFinding[];
  suppressed: ReviewFinding[];
} {
  const suppressed: ReviewFinding[] = [];
  const kept: ReviewFinding[] = [];

  for (const finding of findings) {
    if (isWorkflowSecretsFalsePositive(finding)) {
      suppressed.push(finding);
      continue;
    }
    kept.push(finding);
  }

  return { findings: kept, suppressed };
}
