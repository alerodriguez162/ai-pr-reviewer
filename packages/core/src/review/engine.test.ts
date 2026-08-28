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

  it("loads playbook from the default branch and filters memory, without silencing security critical", async () => {
    const github = new InMemoryGitHubClient(demoPullRequest);
    github.files.set(
      "main:.ai-pr-reviewer.yml",
      `
focus:
  - authorization
ignore:
  categories:
    - testing
`,
    );
    github.files.set(
      "feat/profile-payments:.ai-pr-reviewer.yml",
      `
ignore:
  categories:
    - security
`,
    );
    github.reviewComments.push({
      id: 7,
      body: "<!-- finding-fp:maintainability:too-many-comments -->",
      user: "dev",
      thumbsUp: 0,
      thumbsDown: 2,
      path: "src/api/users.ts",
    });
    github.reviewComments.push({
      id: 8,
      body: "<!-- finding-fp:security:sql-injection -->",
      user: "dev",
      thumbsUp: 0,
      thumbsDown: 5,
    });

    const aiProvider = new MockAIProvider({
      type: "valid",
      review: {
        summary: "Mixed findings.",
        findings: [
          {
            category: "testing",
            severity: "low",
            confidence: "high",
            title: "Missing unit tests",
            description: "No new tests for the endpoint.",
          },
          {
            category: "maintainability",
            severity: "low",
            confidence: "high",
            title: "Too many comments",
            description: "Comment noise.",
          },
          {
            category: "security",
            severity: "critical",
            confidence: "high",
            title: "SQL injection",
            description: "User input is concatenated into SQL.",
          },
        ],
        positiveObservations: [],
        testingAssessment: { testsDetected: true, coverageConcerns: [], suggestedTests: [] },
        sensitiveAreas: [],
        manualReviewAreas: [],
        recommendation: "approve_with_suggestions",
        insufficientContext: false,
      },
    });

    const review = await reviewPullRequest({
      owner: "acme",
      repo: "frontend",
      pullRequest: 153,
      githubToken: "demo",
      ai: { apiKey: "demo" },
      github,
      aiProvider,
    });

    expect(aiProvider.calls[0]?.context.playbook?.ignoreCategories).toEqual(["testing"]);
    expect(aiProvider.calls[0]?.context.playbook?.ignoreCategories).not.toContain("security");
    expect(review.findings.some((finding) => finding.category === "testing")).toBe(false);
    expect(review.findings.some((finding) => finding.title === "Too many comments")).toBe(false);
    expect(review.findings.some((finding) => finding.category === "security" && finding.severity === "critical")).toBe(
      true,
    );
    expect(review.metadata.playbookLoaded).toBe(true);
    expect(review.metadata.suppressedFindings).toBe(2);
    expect(review.metadata.memoryEntries).toBeGreaterThan(0);
    expect(github.memoryIssue?.body).toContain("ai-pr-reviewer-memory");
  });

  it("does not treat prompt-injection PR text as instructions", async () => {
    expect(SYSTEM_PROMPT_SECURITY).toContain("untrusted data");
    const { review } = await runDemoReview();
    expect(review.score).toBeLessThan(100);
    expect(review.recommendation).not.toBe("approve");
    expect(review.findings.some((finding) => finding.category === "security")).toBe(true);
  });

  it("loads related import and consumer context when enabled in the playbook", async () => {
    const github = new InMemoryGitHubClient(demoPullRequest);
    github.files.set(
      "main:.ai-pr-reviewer.yml",
      `
context:
  enabled: true
  maxDepth: 2
  maxFiles: 10
`,
    );
    github.sourcePaths = [
      "src/api/users.ts",
      "src/services/user-service.ts",
      "src/db.ts",
      "src/routes/admin.ts",
    ];
    github.files.set(
      "abc123:src/api/users.ts",
      "import { getUser } from '../services/user-service';\nexport function updateUser() { return getUser(); }",
    );
    github.files.set(
      "abc123:src/services/user-service.ts",
      "import { db } from '../db';\nexport function getUser() { return db.user; }",
    );
    github.files.set("abc123:src/db.ts", "export const db = { user: {} };");
    github.files.set(
      "abc123:src/routes/admin.ts",
      "import { updateUser } from '../api/users';\nexport const route = updateUser;",
    );

    const pullRequest = {
      ...demoPullRequest,
      headSha: "abc123",
      files: [
        {
          filename: "src/api/users.ts",
          status: "modified" as const,
          additions: 3,
          deletions: 1,
          changes: 4,
          patch: "@@ import change",
        },
      ],
    };
    const scopedGithub = new InMemoryGitHubClient(pullRequest);
    scopedGithub.files = github.files;
    scopedGithub.sourcePaths = github.sourcePaths;

    const aiProvider = new MockAIProvider({ type: "from-tools" });
    const review = await reviewPullRequest({
      owner: "acme",
      repo: "frontend",
      pullRequest: 153,
      githubToken: "demo",
      ai: { apiKey: "demo" },
      github: scopedGithub,
      aiProvider,
    });

    const related = aiProvider.calls[0]?.context.relatedFiles ?? [];
    expect(related.map((file) => file.path)).toEqual(
      expect.arrayContaining(["src/services/user-service.ts", "src/db.ts", "src/routes/admin.ts"]),
    );
    expect(review.metadata.contextFilesLoaded).toBeGreaterThan(0);
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
