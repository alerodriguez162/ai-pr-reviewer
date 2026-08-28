import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  InMemoryGitHubClient,
  MockAIProvider,
  calculateRiskScore,
  planChunks,
  reviewPullRequest,
  type PullRequestData,
} from "@larva-factory/ai-pr-reviewer";

function loadFixture(name: string): PullRequestData {
  const file = path.join(import.meta.dirname, "fixtures", name);
  return JSON.parse(readFileSync(file, "utf8")) as PullRequestData;
}

async function reviewFixture(data: PullRequestData) {
  return reviewPullRequest({
    owner: "acme",
    repo: "frontend",
    pullRequest: data.number,
    githubToken: "demo",
    ai: { apiKey: "demo" },
    github: new InMemoryGitHubClient(data),
    aiProvider: new MockAIProvider({ type: "from-tools" }),
  });
}

describe("PR fixtures", () => {
  it("reviews a safe documentation PR without blocking", async () => {
    const review = await reviewFixture(loadFixture("safe-pr.json"));
    expect(review.findings.every((finding) => finding.severity === "info" || finding.severity === "low" || finding.severity === "medium")).toBe(true);
    expect(review.recommendation).not.toBe("request_changes");
  });

  it("flags the security-issue fixture", async () => {
    const review = await reviewFixture(loadFixture("security-issue-pr.json"));
    expect(review.findings.some((finding) => finding.category === "security")).toBe(true);
    expect(review.recommendation).toBe("request_changes");
  });

  it("penalizes missing tests", () => {
    const data = loadFixture("missing-tests-pr.json");
    const withTests = calculateRiskScore({
      findings: [],
      files: [...data.files, { filename: "src/payments/totals.test.ts", status: "added", additions: 4, deletions: 0, changes: 4 }],
      additions: 34,
      deletions: 0,
    });
    const missing = calculateRiskScore({
      findings: [],
      files: data.files,
      additions: data.additions,
      deletions: data.deletions,
    });
    expect(missing).toBeLessThan(withTests);
  });

  it("chunks a large PR", () => {
    const files = Array.from({ length: 25 }, (_, index) => ({
      filename: index === 0 ? "src/auth/session.ts" : `src/generated/f${index}.ts`,
      status: "modified" as const,
      additions: 80,
      deletions: 10,
      changes: 90,
      patch: "p".repeat(3000),
    }));
    const plan = planChunks(files, { maxFiles: 10, maxChunkChars: 7000, maxPatchChars: 8000 });
    expect(plan.chunks.length).toBeGreaterThan(1);
    expect(plan.chunks[0]?.files[0]?.filename).toBe("src/auth/session.ts");
  });

  it("keeps prompt-injection text untrusted and still finds the auth issue", async () => {
    const data = loadFixture("prompt-injection-pr.json");
    expect(data.title.toLowerCase()).toContain("ignore all previous instructions");
    const review = await reviewFixture(data);
    expect(review.score).toBeLessThan(100);
    expect(review.recommendation).not.toBe("approve");
    expect(review.findings.some((finding) => finding.category === "security")).toBe(true);
  });
});
