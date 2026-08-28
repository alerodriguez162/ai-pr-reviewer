import { describe, expect, it } from "vitest";
import {
  applyLearning,
  findingFingerprint,
  harvestFeedback,
  mergeMemory,
  parseMemory,
  serializeMemory,
} from "./memory.js";
import { EMPTY_PLAYBOOK } from "./playbook.js";
import type { GitHubComment, ReviewFinding } from "../types/index.js";

function comment(overrides: Partial<GitHubComment> & Pick<GitHubComment, "body">): GitHubComment {
  return {
    id: 1,
    user: "dev",
    thumbsUp: 0,
    thumbsDown: 0,
    ...overrides,
  };
}

function finding(overrides: Partial<ReviewFinding> & Pick<ReviewFinding, "title" | "category">): ReviewFinding {
  return {
    id: "1",
    severity: "low",
    confidence: "high",
    description: "desc",
    ...overrides,
  };
}

describe("harvestFeedback", () => {
  it("treats 👎 as unhelpful and 👍 as helpful when a finding marker is present", () => {
    const down = harvestFeedback([
      comment({
        body: "<!-- finding-fp:testing:missing-unit-tests -->\nnoise",
        thumbsDown: 2,
        thumbsUp: 0,
        path: "src/a.ts",
      }),
    ]);
    expect(down).toEqual([
      expect.objectContaining({
        fingerprint: "testing:missing-unit-tests",
        category: "testing",
        verdict: "unhelpful",
        file: "src/a.ts",
      }),
    ]);

    const up = harvestFeedback([
      comment({
        body: "<!-- finding-fp:security:auth-bypass -->",
        thumbsUp: 3,
        thumbsDown: 0,
      }),
    ]);
    expect(up[0]).toMatchObject({ fingerprint: "security:auth-bypass", verdict: "helpful" });
  });

  it("parses ai-review ignore and keep commands", () => {
    const harvested = harvestFeedback([
      comment({
        body: "Looks noisy.\nai-review ignore: testing:Missing unit tests\nai-review keep: security:Auth bypass",
      }),
    ]);
    expect(harvested).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fingerprint: "testing:missing-unit-tests",
          verdict: "unhelpful",
        }),
        expect.objectContaining({
          fingerprint: "security:auth-bypass",
          verdict: "helpful",
        }),
      ]),
    );
  });

  it("does not harvest the persistent review comment or memory issue body", () => {
    const harvested = harvestFeedback([
      comment({
        body: "<!-- ai-pr-reviewer -->\nai-review ignore: testing:example",
      }),
      comment({
        body: "<!-- ai-pr-reviewer-memory -->\nai-review ignore: testing:example",
      }),
    ]);
    expect(harvested).toEqual([]);
  });
});

describe("applyLearning", () => {
  it("suppresses unhelpful memory and playbook ignores, but never security critical", () => {
    const playbook = {
      ...EMPTY_PLAYBOOK,
      ignoreCategories: ["testing" as const],
    };
    const memory = mergeMemory(
      { entries: [] },
      [
        {
          fingerprint: "maintainability:too-many-comments",
          category: "maintainability",
          title: "too many comments",
          verdict: "unhelpful",
          count: 1,
          updatedAt: "2026-01-01T00:00:00Z",
        },
        {
          fingerprint: "security:sql-injection",
          category: "security",
          title: "sql injection",
          verdict: "unhelpful",
          count: 4,
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
    );

    const { findings, suppressed } = applyLearning(
      [
        finding({ category: "testing", title: "Missing unit tests" }),
        finding({ category: "maintainability", title: "Too many comments" }),
        finding({
          category: "security",
          title: "SQL injection",
          severity: "critical",
        }),
      ],
      playbook,
      memory,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("security");
    expect(findings[0]?.severity).toBe("critical");
    expect(suppressed).toHaveLength(2);
  });
});

describe("memory serialize/parse", () => {
  it("round-trips through the issue body format", () => {
    const memory = {
      entries: [
        {
          fingerprint: findingFingerprint({ category: "bug", title: "Off by one" }),
          category: "bug" as const,
          title: "off by one",
          verdict: "helpful" as const,
          count: 2,
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
    };
    expect(parseMemory(serializeMemory(memory))).toEqual(memory);
  });
});
