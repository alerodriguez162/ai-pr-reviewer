import type { GitHubComment, GitHubPort, PullRequestData, PullRequestRef } from "../types/index.js";
import { PullRequestNotFoundError } from "../errors/index.js";

function withReactions(
  comment: Omit<GitHubComment, "thumbsUp" | "thumbsDown"> & Partial<Pick<GitHubComment, "thumbsUp" | "thumbsDown">>,
): GitHubComment {
  return {
    thumbsUp: comment.thumbsUp ?? 0,
    thumbsDown: comment.thumbsDown ?? 0,
    id: comment.id,
    body: comment.body,
    user: comment.user,
    path: comment.path,
  };
}

export class InMemoryGitHubClient implements GitHubPort {
  comments: GitHubComment[] = [];
  reviewComments: GitHubComment[] = [];
  reviewsCreated = 0;
  defaultBranch = "main";
  files = new Map<string, string>();
  sourcePaths: string[] = [];
  memoryIssue: { id: number; body: string } | undefined;

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
    const comment = withReactions({
      id: this.comments.length + 1,
      body,
      user: "ai-pr-reviewer",
    });
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

  async getDefaultBranch(_owner: string, _repo: string): Promise<string> {
    return this.defaultBranch;
  }

  async getFileContent(_owner: string, _repo: string, path: string, ref: string): Promise<string | undefined> {
    return this.files.get(`${ref}:${path}`) ?? this.files.get(path);
  }

  async listSourcePaths(_owner: string, _repo: string, _ref: string): Promise<string[]> {
    if (this.sourcePaths.length > 0) {
      return this.sourcePaths;
    }
    return [...new Set([...this.files.keys()].map((key) => key.split(":").pop()!).filter(Boolean))];
  }

  async listReviewComments(_ref: PullRequestRef): Promise<GitHubComment[]> {
    return this.reviewComments;
  }

  async findMemoryIssue(_owner: string, _repo: string): Promise<{ id: number; body: string } | undefined> {
    return this.memoryIssue;
  }

  async upsertMemoryIssue(
    _owner: string,
    _repo: string,
    body: string,
    issueId?: number,
  ): Promise<{ id: number }> {
    if (this.memoryIssue && (issueId === undefined || issueId === this.memoryIssue.id)) {
      this.memoryIssue = { id: this.memoryIssue.id, body };
      return { id: this.memoryIssue.id };
    }
    const id = issueId ?? (this.memoryIssue?.id ?? 1);
    this.memoryIssue = { id, body };
    return { id };
  }
}
