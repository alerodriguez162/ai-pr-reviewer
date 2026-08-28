import type { GitHubComment, GitHubPort, PullRequestData, PullRequestRef } from "../types/index.js";
import { PullRequestNotFoundError } from "../errors/index.js";

export class InMemoryGitHubClient implements GitHubPort {
  comments: GitHubComment[] = [];
  reviewsCreated = 0;

  constructor(private readonly pullRequest: PullRequestData) {}

  async getPullRequest(ref: PullRequestRef): Promise<PullRequestData> {
    if (
      ref.pullRequestNumber !== this.pullRequest.number &&
      ref.pullRequestNumber !== 153
    ) {
      throw new PullRequestNotFoundError(ref.owner, ref.repo, ref.pullRequestNumber);
    }
    return this.pullRequest;
  }

  async listIssueComments(_ref: PullRequestRef): Promise<GitHubComment[]> {
    return this.comments;
  }

  async createIssueComment(_ref: PullRequestRef, body: string): Promise<GitHubComment> {
    const comment = { id: this.comments.length + 1, body, user: "ai-pr-reviewer" };
    this.comments.push(comment);
    return comment;
  }

  async updateIssueComment(
    _ref: PullRequestRef,
    commentId: number,
    body: string,
  ): Promise<GitHubComment> {
    const existing = this.comments.find((comment) => comment.id === commentId);
    if (!existing) {
      return this.createIssueComment(_ref, body);
    }
    existing.body = body;
    return existing;
  }

  async createReview(): Promise<void> {
    this.reviewsCreated += 1;
  }
}
