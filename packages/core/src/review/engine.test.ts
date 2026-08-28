import { describe, expect, it } from "vitest";
import { reviewPullRequest } from "./engine.js";
import { InMemoryGitHubClient } from "../github/in-memory.js";
import { MockAIProvider } from "../ai/mock.js";
import { demoPullRequest } from "./demo-data.js";
import { SYSTEM_PROMPT_SECURITY } from "../security/injection.js";
import { InMemoryReviewToolExecutor } from "../ai/tools.js";
import { runDemoReview } from "./demo.js";

describe("review engine", () => {
  it("aggregates tool-driven findings and calculates a deterministic score", async () => {
    const github = new InMemoryGitHubClient(demoPullRequest);
    const aiProvider = new MockAIProvider({ type: "from-tools" });
    const review = await reviewPullRequest({
      owner: "acme",
      repo: "frontend",
      pullRequest: 153,
      githubToken: "demo",
      ai: { apiKey: "demo" },
      github,
      aiProvider,
    });

    expect(aiProvider.calls[0]?.toolsUsed).toContain("get_file_patch");
    expect(review.findings.length).toBeGreaterThan(0);
    expect(review.score).toBeGreaterThanOrEqual(0);
    expect(review.score).toBeLessThanOrEqual(100);
    expect(review.sensitiveAreas.length).toBeGreaterThan(0);
    expect(review.testingAssessment.testsDetected).toBe(true);
    expect(review.recommendation).toBe("request_changes");
    expect(review.summary.toLowerCase()).not.toContain("score of 100");
  });

  it("does not treat prompt-injection PR text as instructions", async () => {
    expect(SYSTEM_PROMPT_SECURITY).toContain("untrusted data");
    const { review } = await runDemoReview();
    expect(review.score).toBeLessThan(100);
    expect(review.recommendation).not.toBe("approve");
    expect(review.findings.some((finding) => finding.category === "security")).toBe(true);
  });

  it("rejects unknown tools and arbitrary file access", async () => {
    const tools = new InMemoryReviewToolExecutor({
      pullRequest: demoPullRequest,
      files: demoPullRequest.files,
      commits: demoPullRequest.commits,
    });
    const unknown = await tools.execute("rm", { path: "/etc/passwd" });
    expect(unknown).toEqual({ error: "Unknown or disallowed tool: rm" });
    const missing = await tools.execute("get_file_patch", { path: "../secrets.env" });
    expect(missing).toMatchObject({ error: expect.stringContaining("Arbitrary file access is disabled") });
  });
});
