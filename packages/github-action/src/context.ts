import { readFileSync } from "node:fs";
import type { ActionContext } from "./run.js";

interface GitHubEventPayload {
  pull_request?: { number?: number };
  number?: number;
}

export function detectPullRequestContext(
  env: NodeJS.ProcessEnv,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): ActionContext {
  const repository = env.GITHUB_REPOSITORY;
  if (!repository || !repository.includes("/")) {
    throw new Error("GITHUB_REPOSITORY is missing. This Action only runs on GitHub pull requests.");
  }
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) {
    throw new Error("GITHUB_REPOSITORY must be in owner/repo format.");
  }

  const eventPath = env.GITHUB_EVENT_PATH;
  let pullRequestNumber = Number(env.GITHUB_PR_NUMBER ?? "");
  if (eventPath) {
    const payload = JSON.parse(readFile(eventPath)) as GitHubEventPayload;
    pullRequestNumber = payload.pull_request?.number ?? payload.number ?? pullRequestNumber;
  }

  if (!Number.isInteger(pullRequestNumber) || pullRequestNumber <= 0) {
    throw new Error("Could not detect a pull request number from the GitHub event payload.");
  }

  return { owner, repo, pullRequestNumber };
}
