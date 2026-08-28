import { Octokit } from "@octokit/rest";
import {
  GitHubAuthError,
  GitHubPublishError,
  GitHubRateLimitError,
  PrivateRepositoryAccessError,
  PullRequestNotFoundError,
} from "../errors/index.js";
import { MEMORY_ISSUE_TITLE, MEMORY_MARKER } from "../review/memory.js";
import { redactSecrets } from "../security/redaction.js";
import type {
  CreateReviewInput,
  GitHubComment,
  GitHubPort,
  PullRequestCommit,
  PullRequestData,
  PullRequestFile,
  PullRequestRef,
} from "../types/index.js";

interface OctokitErrorLike {
  status?: number;
  message?: string;
}

interface ReactionBundle {
  "+1"?: number;
  "-1"?: number;
}

interface CommentLike {
  id: number;
  body?: string | null;
  user?: { login?: string | null } | null;
  reactions?: ReactionBundle | null;
  path?: string;
}

function asOctokitError(error: unknown): OctokitErrorLike {
  if (error && typeof error === "object") {
    return error as OctokitErrorLike;
  }
  return {};
}

function mapGitHubError(error: unknown, ref: PullRequestRef): never {
  const parsed = asOctokitError(error);
  if (parsed.status === 401 || parsed.status === 403) {
    const message = parsed.message ?? "";
    if (/rate limit/i.test(message) || parsed.status === 403 && /rate/i.test(message)) {
      throw new GitHubRateLimitError();
    }
    if (/not found|resource not accessible/i.test(message)) {
      throw new PrivateRepositoryAccessError();
    }
    throw new GitHubAuthError();
  }
  if (parsed.status === 404) {
    throw new PullRequestNotFoundError(ref.owner, ref.repo, ref.pullRequestNumber);
  }
  if (parsed.status === 429) {
    throw new GitHubRateLimitError();
  }
  throw error;
}

function repoRef(owner: string, repo: string): PullRequestRef {
  return { owner, repo, pullRequestNumber: 0 };
}

function mapComment(comment: CommentLike): GitHubComment {
  return {
    id: comment.id,
    body: comment.body ?? "",
    user: comment.user?.login ?? "unknown",
    thumbsUp: comment.reactions?.["+1"] ?? 0,
    thumbsDown: comment.reactions?.["-1"] ?? 0,
    path: comment.path,
  };
}

export class OctokitGitHubClient implements GitHubPort {
  private readonly octokit: Octokit;

  constructor(token: string, octokit?: Octokit) {
    this.octokit = octokit ?? new Octokit({
      auth: token,
      userAgent: "ai-pr-reviewer",
    });
  }

  async getPullRequest(ref: PullRequestRef): Promise<PullRequestData> {
    try {
      const { data } = await this.octokit.pulls.get({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.pullRequestNumber,
      });

      const [files, commits] = await Promise.all([
        this.listFiles(ref),
        this.listCommits(ref),
      ]);

      return {
        number: data.number,
        title: data.title,
        description: data.body ?? "",
        author: data.user?.login ?? "unknown",
        state: data.state,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        baseBranch: data.base.ref,
        headBranch: data.head.ref,
        headSha: data.head.sha,
        additions: data.additions,
        deletions: data.deletions,
        changedFiles: data.changed_files,
        mergeable: data.mergeable,
        files,
        commits,
      };
    } catch (error) {
      mapGitHubError(error, ref);
    }
  }

  async listFiles(ref: PullRequestRef): Promise<PullRequestFile[]> {
    try {
      const files = await this.octokit.paginate(this.octokit.pulls.listFiles, {
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.pullRequestNumber,
        per_page: 100,
      });

      return files.map((file) => ({
        filename: file.filename,
        status: file.status as PullRequestFile["status"],
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        patch: file.patch ? redactSecrets(file.patch).text : undefined,
        previousFilename: file.previous_filename,
      }));
    } catch (error) {
      mapGitHubError(error, ref);
    }
  }

  async listCommits(ref: PullRequestRef): Promise<PullRequestCommit[]> {
    try {
      const commits = await this.octokit.paginate(this.octokit.pulls.listCommits, {
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.pullRequestNumber,
        per_page: 100,
      });

      return commits.map((commit) => ({
        sha: commit.sha,
        message: redactSecrets(commit.commit.message).text,
        author: commit.author?.login ?? commit.commit.author?.name ?? "unknown",
      }));
    } catch (error) {
      mapGitHubError(error, ref);
    }
  }

  async listIssueComments(ref: PullRequestRef): Promise<GitHubComment[]> {
    try {
      const comments = await this.octokit.paginate(this.octokit.issues.listComments, {
        owner: ref.owner,
        repo: ref.repo,
        issue_number: ref.pullRequestNumber,
        per_page: 100,
      });
      return comments.map((comment) => mapComment(comment));
    } catch (error) {
      mapGitHubError(error, ref);
    }
  }

  async createIssueComment(ref: PullRequestRef, body: string): Promise<GitHubComment> {
    try {
      const { data } = await this.octokit.issues.createComment({
        owner: ref.owner,
        repo: ref.repo,
        issue_number: ref.pullRequestNumber,
        body,
      });
      return mapComment(data);
    } catch (error) {
      throw new GitHubPublishError(error instanceof Error ? error.message : "Failed to create PR comment.");
    }
  }

  async updateIssueComment(
    ref: PullRequestRef,
    commentId: number,
    body: string,
  ): Promise<GitHubComment> {
    try {
      const { data } = await this.octokit.issues.updateComment({
        owner: ref.owner,
        repo: ref.repo,
        comment_id: commentId,
        body,
      });
      return mapComment(data);
    } catch (error) {
      throw new GitHubPublishError(error instanceof Error ? error.message : "Failed to update PR comment.");
    }
  }

  async createReview(input: CreateReviewInput): Promise<void> {
    try {
      await this.octokit.pulls.createReview({
        owner: input.ref.owner,
        repo: input.ref.repo,
        pull_number: input.ref.pullRequestNumber,
        commit_id: input.commitId,
        body: input.body,
        event: input.event,
        comments: input.comments.map((comment) => ({
          path: comment.path,
          line: comment.line,
          body: comment.body,
          side: "RIGHT" as const,
        })),
      });
    } catch (error) {
      throw new GitHubPublishError(error instanceof Error ? error.message : "Failed to create PR review.");
    }
  }

  async getDefaultBranch(owner: string, repo: string): Promise<string> {
    try {
      const { data } = await this.octokit.repos.get({ owner, repo });
      return data.default_branch;
    } catch (error) {
      mapGitHubError(error, repoRef(owner, repo));
    }
  }

  async getFileContent(owner: string, repo: string, path: string, ref: string): Promise<string | undefined> {
    try {
      const { data } = await this.octokit.repos.getContent({ owner, repo, path, ref });
      if (Array.isArray(data) || data.type !== "file" || typeof data.content !== "string") {
        return undefined;
      }
      return Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8");
    } catch (error) {
      if (asOctokitError(error).status === 404) {
        return undefined;
      }
      mapGitHubError(error, repoRef(owner, repo));
    }
  }

  async listSourcePaths(owner: string, repo: string, ref: string): Promise<string[]> {
    try {
      const { data: commit } = await this.octokit.git.getCommit({
        owner,
        repo,
        commit_sha: ref,
      });
      const { data: tree } = await this.octokit.git.getTree({
        owner,
        repo,
        tree_sha: commit.tree.sha,
        recursive: "true",
      });
      return (tree.tree ?? [])
        .filter((item) => item.type === "blob" && typeof item.path === "string")
        .map((item) => item.path as string);
    } catch (error) {
      mapGitHubError(error, repoRef(owner, repo));
    }
  }

  async listReviewComments(ref: PullRequestRef): Promise<GitHubComment[]> {
    try {
      const comments = await this.octokit.paginate(this.octokit.pulls.listReviewComments, {
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.pullRequestNumber,
        per_page: 100,
      });
      return comments.map((comment) => mapComment(comment));
    } catch (error) {
      mapGitHubError(error, ref);
    }
  }

  async findMemoryIssue(owner: string, repo: string): Promise<{ id: number; body: string } | undefined> {
    try {
      const iterator = this.octokit.paginate.iterator(this.octokit.issues.listForRepo, {
        owner,
        repo,
        state: "all",
        per_page: 100,
        sort: "updated",
        direction: "desc",
      });
      for await (const page of iterator) {
        for (const issue of page.data) {
          if (issue.pull_request) {
            continue;
          }
          const body = issue.body ?? "";
          if (issue.title === MEMORY_ISSUE_TITLE || body.includes(MEMORY_MARKER)) {
            return { id: issue.number, body };
          }
        }
      }
      return undefined;
    } catch (error) {
      mapGitHubError(error, repoRef(owner, repo));
    }
  }

  async upsertMemoryIssue(
    owner: string,
    repo: string,
    body: string,
    issueId?: number,
  ): Promise<{ id: number }> {
    try {
      if (issueId !== undefined) {
        const { data } = await this.octokit.issues.update({
          owner,
          repo,
          issue_number: issueId,
          title: MEMORY_ISSUE_TITLE,
          body,
        });
        return { id: data.number };
      }
      const { data } = await this.octokit.issues.create({
        owner,
        repo,
        title: MEMORY_ISSUE_TITLE,
        body,
      });
      return { id: data.number };
    } catch (error) {
      throw new GitHubPublishError(
        error instanceof Error ? error.message : "Failed to persist review memory.",
      );
    }
  }
}
