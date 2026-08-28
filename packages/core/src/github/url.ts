import { InvalidPullRequestUrlError } from "../errors/index.js";
import type { PullRequestRef } from "../types/index.js";

const GITHUB_PR_URL =
  /^https:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/(?:files|commits|checks|changes)?)?(?:[/?#].*)?$/i;

/**
 * Parses a standard github.com pull request URL.
 * Rejects non-GitHub hosts, gists, malformed paths, and non-numeric PR ids.
 */
export function parsePullRequestUrl(input: string): PullRequestRef {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new InvalidPullRequestUrlError("Pull request URL is empty.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new InvalidPullRequestUrlError(`Not a valid URL: ${trimmed}`);
  }

  if (parsed.protocol !== "https:") {
    throw new InvalidPullRequestUrlError("Only https GitHub pull request URLs are supported.");
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") {
    throw new InvalidPullRequestUrlError(
      "Only github.com pull request URLs are supported. Arbitrary URL fetching is disabled.",
    );
  }

  const match = GITHUB_PR_URL.exec(trimmed);
  if (!match) {
    throw new InvalidPullRequestUrlError(
      "URL must look like https://github.com/{owner}/{repo}/pull/{number}",
    );
  }

  const owner = match[1];
  const repo = match[2];
  const pullRequestNumber = Number(match[3]);

  if (!owner || !repo || !Number.isInteger(pullRequestNumber) || pullRequestNumber <= 0) {
    throw new InvalidPullRequestUrlError("Owner, repository, and a positive PR number are required.");
  }

  if (owner === "." || owner === ".." || repo === "." || repo === "..") {
    throw new InvalidPullRequestUrlError("Invalid owner or repository name.");
  }

  return { owner, repo, pullRequestNumber };
}

export function formatPullRequestRef(ref: PullRequestRef): string {
  return `${ref.owner}/${ref.repo}#${ref.pullRequestNumber}`;
}
