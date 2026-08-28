import { describe, expect, it } from "vitest";
import { OctokitGitHubClient } from "./client.js";
import { GitHubAuthError, GitHubRateLimitError, PullRequestNotFoundError } from "../errors/index.js";
import type { Octokit } from "@octokit/rest";

function fakeOctokit(overrides: {
  get?: () => Promise<unknown>;
  paginate?: (endpoint: unknown, params: unknown) => Promise<unknown[]>;
  status?: number;
  message?: string;
}): Octokit {
  const fail = async (): Promise<never> => {
    const error = new Error(overrides.message ?? "boom") as Error & { status?: number };
    error.status = overrides.status;
    throw error;
  };

  return {
    pulls: {
      get: overrides.get ?? fail,
      listFiles: { endpoint: "pulls.listFiles" },
      listCommits: { endpoint: "pulls.listCommits" },
    },
    paginate: overrides.paginate ?? (async () => []),
    issues: {
      listComments: { endpoint: "issues.listComments" },
      createComment: async () => ({ data: { id: 1, body: "x", user: { login: "bot" } } }),
      updateComment: async () => ({ data: { id: 1, body: "x", user: { login: "bot" } } }),
    },
  } as unknown as Octokit;
}

describe("OctokitGitHubClient", () => {
  it("paginates files across pages", async () => {
    const pages = Array.from({ length: 120 }, (_, index) => ({
      filename: `src/f${index}.ts`,
      status: "modified",
      additions: 1,
      deletions: 0,
      changes: 1,
      patch: "@@ -1 +1 @@\n+ok",
    }));
    const client = new OctokitGitHubClient("token", fakeOctokit({
      get: async () => ({
        data: {
          number: 1,
          title: "t",
          body: "d",
          user: { login: "dev" },
          state: "open",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
          base: { ref: "main" },
          head: { ref: "feat", sha: "abc" },
          additions: 120,
          deletions: 0,
          changed_files: 120,
          mergeable: true,
        },
      }),
      paginate: async (endpoint, params) => {
        const typed = params as { per_page?: number };
        expect(typed.per_page).toBe(100);
        const name = (endpoint as { endpoint?: string }).endpoint;
        if (name === "pulls.listCommits") {
          return [
            {
              sha: "abc",
              commit: { message: "m", author: { name: "dev" } },
              author: { login: "dev" },
            },
          ];
        }
        return pages;
      },
    }));

    const pr = await client.getPullRequest({ owner: "acme", repo: "app", pullRequestNumber: 1 });
    expect(pr.files).toHaveLength(120);
    expect(pr.files[0]?.filename).toBe("src/f0.ts");
  });

  it("maps 404 to PullRequestNotFoundError", async () => {
    const client = new OctokitGitHubClient(
      "token",
      fakeOctokit({ status: 404, message: "Not Found" }),
    );
    await expect(
      client.getPullRequest({ owner: "acme", repo: "app", pullRequestNumber: 9 }),
    ).rejects.toBeInstanceOf(PullRequestNotFoundError);
  });

  it("maps 401 to GitHubAuthError", async () => {
    const client = new OctokitGitHubClient("token", fakeOctokit({ status: 401, message: "Bad credentials" }));
    await expect(
      client.getPullRequest({ owner: "acme", repo: "app", pullRequestNumber: 1 }),
    ).rejects.toBeInstanceOf(GitHubAuthError);
  });

  it("maps rate limits", async () => {
    const client = new OctokitGitHubClient(
      "token",
      fakeOctokit({ status: 403, message: "API rate limit exceeded" }),
    );
    await expect(
      client.getPullRequest({ owner: "acme", repo: "app", pullRequestNumber: 1 }),
    ).rejects.toBeInstanceOf(GitHubRateLimitError);
  });
});
