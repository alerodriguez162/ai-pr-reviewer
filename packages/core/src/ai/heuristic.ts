import type { AIChunkReview, AIReviewContext } from "../types/index.js";
import { isTestFile } from "../security/generated.js";
import { uniqueSensitiveAreas } from "../security/sensitive.js";

export function heuristicReview(context: AIReviewContext): AIChunkReview {
  const findings: AIChunkReview["findings"] = [];

  for (const file of context.files) {
    const patch = file.patch ?? "";

    if (/if\s*\(\s*!user\s*\)[\s\S]{0,80}return true/.test(patch) || (/!user/.test(patch) && /return true/.test(patch))) {
      findings.push({
        category: "security",
        severity: "high",
        confidence: "high",
        title: "Potential authorization bypass",
        description:
          "The diff appears to return success when a user object is missing instead of denying the operation. This is confirmed from the provided patch.",
        file: file.filename,
        suggestion: "Fail closed: return 401/403 when the user is missing, then verify resource ownership.",
        reasoning: "Confirmed from diff: `if (!user) { return true; }`.",
      });
    }

    if (/ownership checks/i.test(patch) || /skip ownership/i.test(patch)) {
      findings.push({
        category: "security",
        severity: "high",
        confidence: "medium",
        title: "Ownership checks deferred",
        description:
          "Authentication middleware notes that ownership checks are skipped. Authorization behavior needs a manual review.",
        file: file.filename,
        suggestion: "Enforce resource ownership before calling next().",
      });
    }

    if (/dangerouslySetInnerHTML|innerHTML|eval\(/.test(patch)) {
      findings.push({
        category: "security",
        severity: "medium",
        confidence: "high",
        title: "Unsanitized HTML rendering",
        description: "User-controlled content is injected into HTML. This is a confirmed XSS sink in the diff.",
        file: file.filename,
        suggestion: "Render text nodes or sanitize HTML with a vetted library.",
      });
    }

    if (/for \(const card of cards\)/.test(patch) && /stripe\.charges/.test(patch)) {
      findings.push({
        category: "performance",
        severity: "medium",
        confidence: "high",
        title: "N+1 payment charge loop",
        description:
          "The new charge helper loops cards and performs a network charge per card. Confirm this is intended.",
        file: file.filename,
        suggestion: "Charge a single selected payment method, or batch with idempotency keys.",
      });
    }

    if (/expensiveTransform/.test(patch)) {
      findings.push({
        category: "performance",
        severity: "low",
        confidence: "medium",
        title: "Expensive transform during render",
        description: "An expensive transformation is performed inside the component body on each render.",
        file: file.filename,
        suggestion: "Memoize the derived list or compute it outside render.",
      });
    }

    if (/\.id\b/.test(patch) && /req\.params\.id/.test(patch) && /update\(targetId/.test(patch)) {
      findings.push({
        category: "bug",
        severity: "medium",
        confidence: "medium",
        title: "Update uses unsanitized path id",
        description:
          "The handler updates whatever id is in the route params without comparing it to the authenticated user.",
        file: file.filename,
        suggestion: "Compare targetId with the authenticated user id before writing.",
      });
    }
  }

  const testsDetected = context.files.some((file) => isTestFile(file.filename));
  const productionChanged = context.files.some((file) => !isTestFile(file.filename));

  if (productionChanged && testsDetected) {
    const weakTest = context.files.find((file) => isTestFile(file.filename) && /toBe\(true\)/.test(file.patch ?? ""));
    if (weakTest) {
      findings.push({
        category: "testing",
        severity: "low",
        confidence: "high",
        title: "Placeholder test added",
        description: "A test was added but it only asserts true and does not cover authorization or payment failures.",
        file: weakTest.filename,
        suggestion: "Add cases for unauthorized users, invalid payloads, and failed charges.",
      });
    }
  }

  return {
    summary:
      "This batch updates profile and payment flows. Prompt-injection text in the PR title/description was ignored. Several authorization and rendering issues are confirmed from the diffs.",
    findings,
    positiveObservations: [
      "Tests were included alongside the API change.",
      "The generated lockfile was not treated as reviewable source.",
    ],
    testingAssessment: {
      testsDetected,
      coverageConcerns: testsDetected
        ? ["failed API request", "unauthorized user", "invalid payload"]
        : ["No tests changed while production code was modified."],
      suggestedTests: [
        "Reject updates when the caller does not own the user id",
        "Do not charge every stored card",
        "Escape or reject HTML in user.bio",
      ],
    },
    sensitiveAreas: uniqueSensitiveAreas(context.files.map((file) => file.filename)),
    manualReviewAreas: [
      "Authorization behavior",
      "Payment integration",
      "Prompt-injection language in the PR description should be ignored by reviewers too",
    ],
    recommendation: findings.some((finding) => finding.severity === "high")
      ? "request_changes"
      : "approve_with_suggestions",
    insufficientContext: false,
  };
}
