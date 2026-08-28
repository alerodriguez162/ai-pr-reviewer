import {
  GitHubReviewPublisher,
  OctokitGitHubClient,
  reviewPullRequest,
  SEVERITY_ORDER,
  toUserFacingError,
  type PullRequestReview,
  type ReviewLogger,
  type Severity,
} from "@larva-factory/ai-pr-reviewer";
import { buildActionOutputs, type ActionInputs } from "./inputs.js";

export interface ActionContext {
  owner: string;
  repo: string;
  pullRequestNumber: number;
}

export interface ActionRuntime {
  logger: ReviewLogger;
  setOutput(name: string, value: string): void;
  setFailed(message: string): void;
}

export interface ActionResult {
  review: PullRequestReview;
  published: boolean;
  failedOnSeverity: boolean;
}

export async function runAction(
  inputs: ActionInputs,
  context: ActionContext,
  runtime: ActionRuntime,
  overrides?: {
    github?: ConstructorParameters<typeof GitHubReviewPublisher>[0];
    review?: typeof reviewPullRequest;
  },
): Promise<ActionResult> {
  runtime.logger.info("✓ Pull Request detected");

  const github = overrides?.github ?? new OctokitGitHubClient(inputs.githubToken);
  const reviewFn = overrides?.review ?? reviewPullRequest;

  const review = await reviewFn({
    owner: context.owner,
    repo: context.repo,
    pullRequest: context.pullRequestNumber,
    githubToken: inputs.githubToken,
    ai: { apiKey: inputs.openaiApiKey, model: inputs.model },
    maxFiles: inputs.maxFiles,
    maxDiffChars: inputs.maxDiffSize,
    reviewTests: inputs.reviewTests,
    reviewSecurity: inputs.reviewSecurity,
    logger: runtime.logger,
    github,
  });

  runtime.logger.info(`✓ ${review.statistics.filesChanged} files found`);
  runtime.logger.info(`✓ ${review.metadata.filesReviewed} files selected for review`);
  runtime.logger.info(`✓ ${review.metadata.chunksAnalyzed} analysis batches completed`);
  runtime.logger.info("✓ Findings aggregated");
  runtime.logger.info("✓ Risk calculated");

  let published = false;
  if (inputs.postReview) {
    const publisher = new GitHubReviewPublisher(github);
    await publisher.publish(
      {
        owner: context.owner,
        repo: context.repo,
        pullRequestNumber: context.pullRequestNumber,
      },
      await github.getPullRequest({
        owner: context.owner,
        repo: context.repo,
        pullRequestNumber: context.pullRequestNumber,
      }),
      review,
      {
        postReview: true,
        severityThreshold: inputs.severityThreshold,
      },
    );
    published = true;
    runtime.logger.info("✓ PR comment updated");
  } else {
    runtime.logger.info("post-review=false — skipping GitHub publish");
  }

  const outputs = buildActionOutputs({
    score: review.score,
    riskLevel: review.riskLevel,
    recommendation: review.recommendation,
    findingsCount: review.findings.length,
    criticalFindings: review.findings.filter((finding) => finding.severity === "critical").length,
    highFindings: review.findings.filter((finding) => finding.severity === "high").length,
  });
  for (const [name, value] of Object.entries(outputs)) {
    runtime.setOutput(name, value);
  }

  runtime.logger.info("Review complete.");
  runtime.logger.info(`Score: ${review.score}/100`);
  runtime.logger.info(`Risk: ${review.riskLevel}`);
  runtime.logger.info(`Findings: ${review.findings.length}`);

  const failedOnSeverity = exceedsSeverity(review, inputs.failOnSeverity);
  if (failedOnSeverity) {
    runtime.setFailed(
      `Review found findings at or above the fail-on-severity threshold (${inputs.failOnSeverity}).`,
    );
  }

  return { review, published, failedOnSeverity };
}

export function exceedsSeverity(review: PullRequestReview, threshold: Severity): boolean {
  return review.findings.some(
    (finding) => SEVERITY_ORDER[finding.severity] >= SEVERITY_ORDER[threshold],
  );
}

export function formatActionFailure(error: unknown): string {
  return toUserFacingError(error);
}
