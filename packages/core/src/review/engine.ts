import { OctokitGitHubClient } from "../github/client.js";
import { OpenAIProvider } from "../ai/openai.js";
import { InMemoryReviewToolExecutor } from "../ai/tools.js";
import { planChunks } from "../chunking/chunk.js";
import { MissingConfigurationError } from "../errors/index.js";
import { createLogger } from "../logging/logger.js";
import { dedupeFindings, normalizeFinding } from "./aggregation.js";
import { applyRecommendationGuardrails, calculateRiskScore, riskLevelFromScore } from "../scoring/risk.js";
import { uniqueSensitiveAreas } from "../security/sensitive.js";
import { isTestFile } from "../security/generated.js";
import { redactSecrets } from "../security/redaction.js";
import { EMPTY_PLAYBOOK, PLAYBOOK_PATHS, isPlaybookEmpty, parsePlaybook } from "./playbook.js";
import {
  applyLearning,
  harvestFeedback,
  mergeMemory,
  parseMemory,
  serializeMemory,
} from "./memory.js";
import { loadRelatedContext, type LoadedReviewContext } from "../context/loader.js";
import type {
  AIChunkReview,
  GitHubPort,
  PullRequestData,
  PullRequestReview,
  ReviewFinding,
  ReviewLogger,
  ReviewMemory,
  ReviewOptions,
  ReviewPlaybook,
  TestingAssessment,
} from "../types/index.js";

export async function reviewPullRequest(options: ReviewOptions): Promise<PullRequestReview> {
  const logger = options.logger ?? createLogger();
  const github = options.github ?? createGitHub(options.githubToken);
  const ai = options.aiProvider ?? createOpenAI(options);
  const ref = {
    owner: options.owner,
    repo: options.repo,
    pullRequestNumber: options.pullRequest,
  };

  logger.info("Fetching PR metadata...");
  const [pullRequest, learned] = await Promise.all([
    github.getPullRequest(ref),
    resolvePlaybookAndMemory(options, github, logger),
  ]);
  const { playbook, memory, memoryIssueId } = learned;

  logger.info(`Found ${pullRequest.files.length} changed files.`);

  const relatedContext = await loadRelatedContext(
    github,
    options.owner,
    options.repo,
    pullRequest,
    playbook,
    logger,
  );

  const plan = planChunks(pullRequest.files, {
    maxFiles: options.maxFiles ?? 40,
    maxPatchChars: options.maxDiffChars ?? 8000,
  });

  if (plan.skippedGenerated.length > 0) {
    logger.info(`Ignoring ${plan.skippedGenerated.length} generated files.`);
  }
  if (plan.skippedOversized.length > 0) {
    logger.warn(`Skipping ${plan.skippedOversized.length} oversized diffs.`);
  }

  const selectedCount = plan.chunks.reduce((sum, chunk) => sum + chunk.files.length, 0);
  logger.info(`Analyzing ${selectedCount} files in ${plan.chunks.length} batches...`);

  const chunkReviews: AIChunkReview[] = [];
  for (const chunk of plan.chunks) {
    const tools = new InMemoryReviewToolExecutor({
      pullRequest,
      files: chunk.files,
      commits: pullRequest.commits,
      playbook,
      memory,
      relatedFiles: relatedContext.files,
    });
    const result = await ai.reviewChunk(
      {
        pullRequest,
        files: chunk.files,
        commits: pullRequest.commits,
        playbook,
        memory,
        relatedFiles: relatedContext.files,
      },
      tools,
    );
    chunkReviews.push(result);
  }

  logger.info("Aggregating findings...");
  const review = assembleReview(
    pullRequest,
    plan,
    chunkReviews,
    options,
    playbook,
    memory,
    relatedContext,
  );

  if (options.persistMemory !== false) {
    try {
      await github.upsertMemoryIssue(
        options.owner,
        options.repo,
        serializeMemory(memory),
        memoryIssueId,
      );
    } catch {
      logger.warn("Could not persist review memory.");
    }
  }

  logger.info(`Calculated risk score: ${review.score}.`);
  logger.info("Review complete.");
  return review;
}

async function resolvePlaybookAndMemory(
  options: ReviewOptions,
  github: GitHubPort,
  logger: ReviewLogger,
): Promise<{ playbook: ReviewPlaybook; memory: ReviewMemory; memoryIssueId?: number }> {
  const playbook = options.playbook ?? (await loadPlaybookFromDefaultBranch(github, options, logger));

  let memory = options.memory ?? { entries: [] };
  let memoryIssueId: number | undefined;
  if (!options.memory) {
    try {
      const issue = await github.findMemoryIssue(options.owner, options.repo);
      if (issue) {
        memory = parseMemory(issue.body);
        memoryIssueId = issue.id;
      }
    } catch {
      logger.warn("Could not load review memory; continuing without it.");
    }
  }

  try {
    const ref = {
      owner: options.owner,
      repo: options.repo,
      pullRequestNumber: options.pullRequest,
    };
    const [issueComments, reviewComments] = await Promise.all([
      github.listIssueComments(ref),
      github.listReviewComments(ref),
    ]);
    memory = mergeMemory(memory, harvestFeedback([...issueComments, ...reviewComments]));
  } catch {
    logger.warn("Could not harvest review feedback; continuing with existing memory.");
  }

  return { playbook, memory, memoryIssueId };
}

async function loadPlaybookFromDefaultBranch(
  github: GitHubPort,
  options: ReviewOptions,
  logger: ReviewLogger,
): Promise<ReviewPlaybook> {
  try {
    // Always the default branch — never the PR head — to block prompt injection via playbook files.
    const defaultBranch = await github.getDefaultBranch(options.owner, options.repo);
    for (const path of PLAYBOOK_PATHS) {
      const content = await github.getFileContent(options.owner, options.repo, path, defaultBranch);
      if (content !== undefined) {
        const playbook = parsePlaybook(content);
        if (!isPlaybookEmpty(playbook)) {
          logger.info(`Loaded playbook from ${path} on ${defaultBranch}.`);
        }
        return playbook;
      }
    }
  } catch {
    logger.warn("Could not load playbook from the default branch; continuing without it.");
  }
  return EMPTY_PLAYBOOK;
}

function assembleReview(
  pullRequest: PullRequestData,
  plan: ReturnType<typeof planChunks>,
  chunkReviews: AIChunkReview[],
  options: ReviewOptions,
  playbook: ReviewPlaybook,
  memory: ReviewMemory,
  relatedContext: LoadedReviewContext,
): PullRequestReview {
  const rawFindings = chunkReviews.flatMap((chunk) => chunk.findings);
  const unfiltered = dedupeFindings(
    rawFindings
      .filter((finding) => options.reviewSecurity !== false || finding.category !== "security")
      .map((finding, index) => normalizeFinding(toFinding(finding, index), index)),
  );
  const { findings, suppressed } = applyLearning(unfiltered, playbook, memory);

  const testsDetected =
    pullRequest.files.some((file) => isTestFile(file.filename)) ||
    chunkReviews.some((chunk) => chunk.testingAssessment.testsDetected);

  const testingAssessment: TestingAssessment = mergeTesting(chunkReviews, testsDetected);
  const insufficientContext = chunkReviews.some((chunk) => chunk.insufficientContext);
  const sensitiveAreas = unique(
    uniqueSensitiveAreas(pullRequest.files.map((file) => file.filename)).concat(
      chunkReviews.flatMap((chunk) => chunk.sensitiveAreas),
    ),
  );

  const manualReviewAreas = unique([
    ...chunkReviews.flatMap((chunk) => chunk.manualReviewAreas),
    ...(insufficientContext ? ["Insufficient context — manual review recommended."] : []),
    ...(plan.skippedOversized.map((file) => `Oversized diff omitted: ${file.filename}`)),
  ]);

  const recommendation = applyRecommendationGuardrails({
    findings,
    files: pullRequest.files,
    insufficientContext,
    aiRecommendation: pickRecommendation(chunkReviews),
  });

  const score = calculateRiskScore({
    findings,
    files: pullRequest.files,
    additions: pullRequest.additions,
    deletions: pullRequest.deletions,
  });

  const usage =
    options.aiProvider && "lastUsage" in options.aiProvider
      ? (options.aiProvider as OpenAIProvider).lastUsage
      : undefined;

  return {
    summary: mergeSummaries(pullRequest.title, chunkReviews),
    score,
    riskLevel: riskLevelFromScore(score),
    statistics: {
      filesChanged: pullRequest.changedFiles || pullRequest.files.length,
      additions: pullRequest.additions,
      deletions: pullRequest.deletions,
    },
    findings,
    positiveObservations: unique(chunkReviews.flatMap((chunk) => chunk.positiveObservations)),
    testingAssessment,
    sensitiveAreas,
    manualReviewAreas,
    recommendation,
    metadata: {
      model: options.ai.model ?? process.env.OPENAI_MODEL,
      usage,
      chunksAnalyzed: plan.chunks.length,
      filesReviewed: plan.chunks.reduce((sum, chunk) => sum + chunk.files.length, 0),
      filesSkippedGenerated: plan.skippedGenerated.length,
      filesSkippedOversized: plan.skippedOversized.length,
      playbookLoaded: !isPlaybookEmpty(playbook),
      memoryEntries: memory.entries.length,
      suppressedFindings: suppressed.length,
      contextFilesLoaded: relatedContext.files.length,
      contextTruncated: relatedContext.truncated,
    },
  };
}

function toFinding(
  finding: AIChunkReview["findings"][number],
  index: number,
): ReviewFinding {
  return {
    id: finding.id ?? `finding-${index + 1}`,
    category: finding.category,
    severity: finding.severity,
    confidence: finding.confidence,
    title: finding.title,
    description: finding.description,
    file: finding.file,
    line: finding.line,
    suggestion: finding.suggestion,
    reasoning: finding.reasoning,
  };
}

function mergeTesting(chunks: AIChunkReview[], testsDetected: boolean): TestingAssessment {
  return {
    testsDetected,
    coverageConcerns: unique(chunks.flatMap((chunk) => chunk.testingAssessment.coverageConcerns)),
    suggestedTests: unique(chunks.flatMap((chunk) => chunk.testingAssessment.suggestedTests)),
  };
}

function mergeSummaries(title: string, chunks: AIChunkReview[]): string {
  if (chunks.length === 0) {
    return `No reviewable source files were found for "${redactSecrets(title).text}".`;
  }
  if (chunks.length === 1 && chunks[0]) {
    return chunks[0].summary;
  }
  return chunks.map((chunk, index) => `Batch ${index + 1}: ${chunk.summary}`).join(" ");
}

function pickRecommendation(chunks: AIChunkReview[]): AIChunkReview["recommendation"] | undefined {
  if (chunks.some((chunk) => chunk.recommendation === "request_changes")) {
    return "request_changes";
  }
  if (chunks.some((chunk) => chunk.recommendation === "manual_review_required")) {
    return "manual_review_required";
  }
  if (chunks.some((chunk) => chunk.recommendation === "approve_with_suggestions")) {
    return "approve_with_suggestions";
  }
  if (chunks.length > 0) {
    return "approve";
  }
  return undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function createGitHub(token: string): OctokitGitHubClient {
  if (!token) {
    throw new MissingConfigurationError("GITHUB_TOKEN is required.");
  }
  return new OctokitGitHubClient(token);
}

function createOpenAI(options: ReviewOptions): OpenAIProvider {
  if (!options.ai.apiKey) {
    throw new MissingConfigurationError("OPENAI_API_KEY is required.");
  }
  return new OpenAIProvider(options.ai, options.logger);
}
