import { describe, expect, it } from "vitest";
import { filterKnownFalsePositives, isWorkflowSecretsFalsePositive } from "./false-positives.js";
import type { ReviewFinding } from "../types/index.js";

function finding(partial: Partial<ReviewFinding> & Pick<ReviewFinding, "title">): ReviewFinding {
  return {
    id: "f1",
    category: "security",
    severity: "medium",
    confidence: "medium",
    title: partial.title,
    description: partial.description ?? "",
    file: partial.file,
    suggestion: partial.suggestion,
  };
}

describe("isWorkflowSecretsFalsePositive", () => {
  it("suppresses standard secrets.* references in workflow files", () => {
    expect(
      isWorkflowSecretsFalsePositive(
        finding({
          title: "Use of Secrets in CI/CD Workflow",
          description: "The workflow uses OPENAI_API_KEY from repository secrets.",
          file: ".github/workflows/ai-pr-review.yml",
        }),
      ),
    ).toBe(true);
  });

  it("keeps hardcoded secret exposure findings", () => {
    expect(
      isWorkflowSecretsFalsePositive(
        finding({
          title: "Hardcoded API key in workflow",
          description: "OPENAI_API_KEY is committed in plaintext in the workflow file.",
          file: ".github/workflows/ai-pr-review.yml",
        }),
      ),
    ).toBe(false);
  });

  it("ignores non-workflow files", () => {
    expect(
      isWorkflowSecretsFalsePositive(
        finding({
          title: "Use of Secrets in CI/CD Workflow",
          file: "src/config.ts",
        }),
      ),
    ).toBe(false);
  });
});

describe("filterKnownFalsePositives", () => {
  it("removes workflow secret false positives from findings", () => {
    const input = [
      finding({
        title: "Exposure of Sensitive Data in CI/CD Workflow",
        file: ".github/workflows/ai-pr-review.yml",
      }),
      finding({
        title: "Missing auth on route",
        file: "src/routes/inventory.ts",
        description: "Unauthenticated PATCH",
      }),
    ];
    const { findings, suppressed } = filterKnownFalsePositives(input);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.title).toBe("Missing auth on route");
    expect(suppressed).toHaveLength(1);
  });
});
