import type { PullRequestData, PullRequestReview } from "../types/index.js";
import { MockAIProvider } from "../ai/mock.js";
import { reviewPullRequest } from "./engine.js";
import { InMemoryGitHubClient } from "../github/in-memory.js";
import { demoPullRequest } from "./demo-data.js";

export interface DemoResult {
  pullRequest: PullRequestData;
  review: PullRequestReview;
}

export async function runDemoReview(data: PullRequestData = demoPullRequest): Promise<DemoResult> {
  const github = new InMemoryGitHubClient(data);
  const aiProvider = new MockAIProvider({ type: "from-tools" });
  const review = await reviewPullRequest({
    owner: "acme",
    repo: "frontend",
    pullRequest: data.number,
    githubToken: "demo",
    ai: { apiKey: "demo" },
    github,
    aiProvider,
  });
  return { pullRequest: data, review };
}
