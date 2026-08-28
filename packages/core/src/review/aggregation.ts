import type { ReviewFinding, Severity } from "../types/index.js";
import { SEVERITY_ORDER } from "../types/index.js";

export function normalizeFinding(finding: ReviewFinding, index: number): ReviewFinding {
  const file = finding.file?.replace(/\\/g, "/");
  const id = finding.id?.trim() || stableFindingId(finding, index);
  return {
    ...finding,
    id,
    title: finding.title.trim(),
    description: finding.description.trim(),
    file,
    suggestion: finding.suggestion?.trim() || undefined,
    reasoning: finding.reasoning?.trim() || undefined,
  };
}

export function stableFindingId(finding: ReviewFinding, index: number): string {
  const key = `${finding.category}:${finding.file ?? "global"}:${slug(finding.title)}`;
  return `finding-${slug(key).slice(0, 48)}-${index + 1}`;
}

export function dedupeFindings(findings: ReviewFinding[]): ReviewFinding[] {
  const seen = new Map<string, ReviewFinding>();
  for (const finding of findings) {
    const key = `${finding.category}|${(finding.file ?? "").toLowerCase()}|${slug(finding.title)}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, finding);
      continue;
    }
    if (SEVERITY_ORDER[finding.severity] > SEVERITY_ORDER[existing.severity]) {
      seen.set(key, finding);
    }
  }
  return [...seen.values()].sort(compareFindings);
}

export function compareFindings(a: ReviewFinding, b: ReviewFinding): number {
  const severity = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
  if (severity !== 0) {
    return severity;
  }
  return a.title.localeCompare(b.title);
}

export function countBySeverity(
  findings: ReviewFinding[],
  severity: Severity,
): number {
  return findings.filter((finding) => finding.severity === severity).length;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
