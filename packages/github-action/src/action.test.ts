import { describe, expect, it } from "vitest";
import { buildActionOutputs, parseActionInputs, parseSeverity } from "../src/inputs.js";
import { detectPullRequestContext } from "../src/context.js";
import { exceedsSeverity, runAction } from "../src/run.js";
import {
  InMemoryGitHubClient,
  MockAIProvider,
  demoPullRequest,
  reviewPullRequest,
  silentLogger,
  type PullRequestReview,
} from "@larva-factory/ai-pr-reviewer";

function inputs(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    "github-token": "gh-token",
    "openai-api-key": "sk-test",
    "severity-threshold": "medium",
    "post-review": "true",
    "fail-on-severity": "critical",
    ...overrides,
  };
  return parseActionInputs({
    getInput: (name) => values[name] ?? "",
    getBooleanInput: (name) => values[name] === "true",
  });
}

describe("GitHub Action inputs and outputs", () => {
  it("parses inputs with defaults", () => {
    const parsed = inputs();
    expect(parsed.severityThreshold).toBe("medium");
    expect(parsed.postReview).toBe(true);
    expect(parsed.failOnSeverity).toBe("critical");
  });

  it("parses severity aliases", () => {
    expect(parseSeverity("HIGH", "medium")).toBe("high");
    expect(parseSeverity("nope", "medium")).toBe("medium");
  });

  it("builds outputs", () => {
    expect(
      buildActionOutputs({
        score: 84,
        riskLevel: "low",
        recommendation: "approve",
        findingsCount: 2,
        criticalFindings: 0,
        highFindings: 1,
      }),
    ).toEqual({
      score: "84",
      "risk-level": "low",
      recommendation: "approve",
      "findings-count": "2",
      "critical-findings": "0",
      "high-findings": "1",
    });
  });

  it("detects PR context from the GitHub event payload", () => {
    const context = detectPullRequestContext(
      {
        GITHUB_REPOSITORY: "acme/frontend",
        GITHUB_EVENT_PATH: "/tmp/event.json",
      },
      () => JSON.stringify({ pull_request: { number: 153 } }),
    );
    expect(context).toEqual({ owner: "acme", repo: "frontend", pullRequestNumber: 153 });
  });

  it("runs the action handler, publishes once, and honors post-review=false", async () => {
    const github = new InMemoryGitHubClient(demoPullRequest);
    const outputs: Record<string, string> = {};
    const result = await runAction(
      inputs(),
      { owner: "acme", repo: "frontend", pullRequestNumber: 153 },
      {
        logger: silentLogger,
        setOutput: (name, value) => {
          outputs[name] = value;
        },
        setFailed: () => undefined,
      },
      {
        github,
        review: async (options) =>
          reviewPullRequest({
            ...options,
            github,
            aiProvider: new MockAIProvider({ type: "from-tools" }),
          }),
      },
    );

    expect(result.published).toBe(true);
    expect(github.comments).toHaveLength(1);
    expect(outputs.score).toBe(String(result.review.score));

    const skipped = await runAction(
      inputs({ "post-review": "false" }),
      { owner: "acme", repo: "frontend", pullRequestNumber: 153 },
      {
        logger: silentLogger,
        setOutput: () => undefined,
        setFailed: () => undefined,
      },
      {
        github,
        review: async () => result.review,
      },
    );
    expect(skipped.published).toBe(false);
    expect(github.comments).toHaveLength(1);
  });

  it("fails on configured severity", () => {
    const review = {
      findings: [{ severity: "high" }],
    } as PullRequestReview;
    expect(exceedsSeverity(review, "high")).toBe(true);
    expect(exceedsSeverity(review, "critical")).toBe(false);
  });
});
