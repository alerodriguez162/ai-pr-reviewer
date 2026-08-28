export class AiPrReviewerError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "AiPrReviewerError";
    this.code = code;
  }
}

export class InvalidPullRequestUrlError extends AiPrReviewerError {
  constructor(message: string) {
    super(message, "INVALID_PR_URL");
    this.name = "InvalidPullRequestUrlError";
  }
}

export class MissingConfigurationError extends AiPrReviewerError {
  constructor(message: string) {
    super(message, "MISSING_CONFIGURATION");
    this.name = "MissingConfigurationError";
  }
}

export class GitHubAuthError extends AiPrReviewerError {
  constructor(message = "GitHub authentication failed. Check GITHUB_TOKEN.") {
    super(message, "GITHUB_AUTH");
    this.name = "GitHubAuthError";
  }
}

export class GitHubRateLimitError extends AiPrReviewerError {
  constructor(message = "GitHub API rate limit exceeded.") {
    super(message, "GITHUB_RATE_LIMIT");
    this.name = "GitHubRateLimitError";
  }
}

export class PullRequestNotFoundError extends AiPrReviewerError {
  constructor(owner: string, repo: string, number: number) {
    super(
      `Pull request ${owner}/${repo}#${number} was not found or is inaccessible.`,
      "PR_NOT_FOUND",
    );
    this.name = "PullRequestNotFoundError";
  }
}

export class PrivateRepositoryAccessError extends AiPrReviewerError {
  constructor(message = "The token cannot access this private repository.") {
    super(message, "PRIVATE_REPO_ACCESS");
    this.name = "PrivateRepositoryAccessError";
  }
}

export class AIProviderError extends AiPrReviewerError {
  constructor(message: string) {
    super(message, "AI_PROVIDER");
    this.name = "AIProviderError";
  }
}

export class AIRateLimitError extends AiPrReviewerError {
  constructor(message = "AI provider rate limit exceeded.") {
    super(message, "AI_RATE_LIMIT");
    this.name = "AIRateLimitError";
  }
}

export class MalformedAIResponseError extends AiPrReviewerError {
  constructor(message = "The AI returned a response that could not be validated.") {
    super(message, "MALFORMED_AI_RESPONSE");
    this.name = "MalformedAIResponseError";
  }
}

export class ContextSizeError extends AiPrReviewerError {
  constructor(message = "The pull request exceeds configured context size limits.") {
    super(message, "CONTEXT_SIZE");
    this.name = "ContextSizeError";
  }
}

export class GitHubPublishError extends AiPrReviewerError {
  constructor(message: string) {
    super(message, "GITHUB_PUBLISH");
    this.name = "GitHubPublishError";
  }
}

export function toUserFacingError(error: unknown): string {
  if (error instanceof AiPrReviewerError) {
    return error.message;
  }
  if (error instanceof Error) {
    return sanitizeErrorMessage(error.message);
  }
  return "An unexpected error occurred.";
}

export function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/ghp_[A-Za-z0-9_]+/g, "[REDACTED]")
    .replace(/gho_[A-Za-z0-9_]+/g, "[REDACTED]")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "[REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
}
