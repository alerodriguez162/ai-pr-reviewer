import { reviewPullRequest } from "./review/engine.js";
import { parsePullRequestUrl, formatPullRequestRef } from "./github/url.js";
import { OctokitGitHubClient } from "./github/client.js";
import { GitHubReviewPublisher, REVIEW_COMMENT_MARKER } from "./github/publisher.js";
import { InMemoryGitHubClient } from "./github/in-memory.js";
import { OpenAIProvider } from "./ai/openai.js";
import { extractJson, parseAndValidateChunkReview, repairLoop } from "./ai/validate.js";
import { MockAIProvider } from "./ai/mock.js";
import { InMemoryReviewToolExecutor } from "./ai/tools.js";
import { planChunks, classifyFiles } from "./chunking/chunk.js";
import { calculateRiskScore, riskLevelFromScore, applyRecommendationGuardrails } from "./scoring/risk.js";
import { redactSecrets } from "./security/redaction.js";
import { classifySensitiveFile, detectSensitiveFiles, isSensitivePath } from "./security/sensitive.js";
import { isGeneratedFile, isTestFile } from "./security/generated.js";
import { formatReviewMarkdown, formatReviewPretty } from "./review/formatter.js";
import { runDemoReview } from "./review/demo.js";
import { demoPullRequest } from "./review/demo-data.js";
import { runCli, parseCliArgs, executeCli } from "./cli/run.js";
import { dedupeFindings, normalizeFinding } from "./review/aggregation.js";
import { createLogger, silentLogger } from "./logging/logger.js";
import { aiChunkReviewSchema } from "./schemas/review.js";
import { toUserFacingError } from "./errors/index.js";
import { SEVERITY_ORDER } from "./types/index.js";

export type {
  PullRequestReview,
  ReviewFinding,
  ReviewOptions,
  AIProvider,
  GitHubPort,
  PullRequestRef,
  PullRequestData,
  Severity,
  Recommendation,
  ReviewLogger,
} from "./types/index.js";

export {
  reviewPullRequest,
  parsePullRequestUrl,
  formatPullRequestRef,
  OctokitGitHubClient,
  GitHubReviewPublisher,
  REVIEW_COMMENT_MARKER,
  InMemoryGitHubClient,
  OpenAIProvider,
  extractJson,
  parseAndValidateChunkReview,
  repairLoop,
  MockAIProvider,
  InMemoryReviewToolExecutor,
  planChunks,
  classifyFiles,
  calculateRiskScore,
  riskLevelFromScore,
  applyRecommendationGuardrails,
  redactSecrets,
  classifySensitiveFile,
  detectSensitiveFiles,
  isSensitivePath,
  isGeneratedFile,
  isTestFile,
  formatReviewMarkdown,
  formatReviewPretty,
  runDemoReview,
  demoPullRequest,
  runCli,
  parseCliArgs,
  executeCli,
  dedupeFindings,
  normalizeFinding,
  createLogger,
  silentLogger,
  aiChunkReviewSchema,
  toUserFacingError,
  SEVERITY_ORDER,
};
