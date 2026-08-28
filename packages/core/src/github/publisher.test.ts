import { describe, expect, it } from "vitest";
import { GitHubReviewPublisher, REVIEW_COMMENT_MARKER } from "./publisher.js";
import { InMemoryGitHubClient } from "./in-memory.js";
import { demoPullRequest } from "../review/demo-data.js";
import { formatReviewMarkdown } from "../review/formatter.js";
import type { PullRequestReview } from "../types/index.js";

const review: PullRequestReview = {
  summary: "Introduces profile updates.",
  score: 72,
  riskLevel: "medium",
  statistics: { filesChanged: 3, additions: 20, deletions: 4 },
  findings: [
    {
      id: "1",
      category: "security",
      severity: "high",
      confidence: "high",
      title: "Potential Authorization Bypass",
      description: "The new endpoint validates authentication but not ownership.",
      file: "src/api/users.ts",
      line: 72,
      suggestion: "Verify ownership before allowing the operation.",
    },
  ],
  positiveObservations: ["Includes a test file"],
  testingAssessment: {
    testsDetected: true,
    coverageConcerns: ["unauthorized user"],
    suggestedTests: ["invalid payload"],
  },
  sensitiveAreas: ["authentication", "api-routes"],
  manualReviewAreas: ["Authorization behavior"],
  recommendation: "approve_with_suggestions",
  metadata: {
    chunksAnalyzed: 1,
    filesReviewed: 3,
    filesSkippedGenerated: 1,
    filesSkippedOversized: 0,
  },
};

describe("publisher and comments", () => {
  it("formats a readable summary, not raw JSON", () => {
    const markdown = formatReviewMarkdown(review);
    expect(markdown).toContain("**Score:** 72/100");
    expect(markdown).toContain("Potential Authorization Bypass");
    expect(markdown).not.toContain('"riskLevel"');
  });

  it("updates an existing marker comment instead of creating another", async () => {
    const github = new InMemoryGitHubClient(demoPullRequest);
    github.comments.push({
      id: 99,
      body: `${REVIEW_COMMENT_MARKER}\nold`,
      user: "bot",
    });
    const publisher = new GitHubReviewPublisher(github);
    const result = await publisher.publish(
      { owner: "acme", repo: "frontend", pullRequestNumber: 153 },
      demoPullRequest,
      review,
      { postReview: true, severityThreshold: "medium", inlineComments: false },
    );
    expect(result.commentId).toBe(99);
    expect(github.comments).toHaveLength(1);
    expect(github.comments[0]?.body).toContain("AI Pull Request Review");
  });

  it("does not publish when postReview is false", async () => {
    const github = new InMemoryGitHubClient(demoPullRequest);
    const publisher = new GitHubReviewPublisher(github);
    const result = await publisher.publish(
      { owner: "acme", repo: "frontend", pullRequestNumber: 153 },
      demoPullRequest,
      review,
      { postReview: false, severityThreshold: "medium" },
    );
    expect(result.commentId).toBeNull();
    expect(github.comments).toHaveLength(0);
  });

  it("only inlines findings that meet the threshold and map to a changed line", async () => {
    const github = new InMemoryGitHubClient(demoPullRequest);
    const publisher = new GitHubReviewPublisher(github);
    const comments = publisher.selectInlineComments(demoPullRequest, review, {
      postReview: true,
      severityThreshold: "medium",
    });
    expect(comments.length).toBe(1);
    expect(comments[0]?.path).toBe("src/api/users.ts");
  });
});
