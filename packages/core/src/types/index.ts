export type Severity = "info" | "low" | "medium" | "high" | "critical";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type Confidence = "low" | "medium" | "high";

export type FindingCategory =
  | "bug"
  | "security"
  | "performance"
  | "maintainability"
  | "code_quality"
  | "testing"
  | "regression";

export type Recommendation =
  | "approve"
  | "approve_with_suggestions"
  | "request_changes"
  | "manual_review_required";

export type FileStatus =
  | "added"
  | "removed"
  | "modified"
  | "renamed"
  | "copied"
  | "changed"
  | "unchanged";

export interface ReviewFinding {
  id: string;
  category: FindingCategory;
  severity: Severity;
  confidence: Confidence;
  title: string;
  description: string;
  file?: string;
  line?: number;
  suggestion?: string;
  reasoning?: string;
}

export type DraftFinding = Omit<ReviewFinding, "id"> & { id?: string };

export interface TestingAssessment {
  testsDetected: boolean;
  coverageConcerns: string[];
  suggestedTests: string[];
}

export interface ReviewStatistics {
  filesChanged: number;
  additions: number;
  deletions: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ReviewMetadata {
  model?: string;
  usage?: TokenUsage;
  chunksAnalyzed: number;
  filesReviewed: number;
  filesSkippedGenerated: number;
  filesSkippedOversized: number;
  playbookLoaded?: boolean;
  memoryEntries?: number;
  suppressedFindings?: number;
  contextFilesLoaded?: number;
  contextTruncated?: boolean;
}

export interface ReviewContextConfig {
  enabled?: boolean;
  maxDepth?: number;
  maxFiles?: number;
  maxFileChars?: number;
  followImports?: boolean;
  findConsumers?: boolean;
  includePaths?: string[];
  excludePaths?: string[];
  consumerScanLimit?: number;
}

export interface ReviewPlaybook {
  focus: string[];
  ignoreCategories: FindingCategory[];
  ignorePaths: string[];
  ignoreTitles: string[];
  style?: string;
  domainNotes: string[];
  context?: ReviewContextConfig;
}

export type FeedbackVerdict = "helpful" | "unhelpful";

export interface ReviewMemoryEntry {
  fingerprint: string;
  category: FindingCategory;
  title: string;
  file?: string;
  verdict: FeedbackVerdict;
  count: number;
  updatedAt: string;
}

export interface ReviewMemory {
  entries: ReviewMemoryEntry[];
}

export interface ReviewOptions {
  owner: string;
  repo: string;
  pullRequest: number;
  githubToken: string;
  ai: AIProviderConfig;
  maxFiles?: number;
  maxDiffChars?: number;
  maxChunkChars?: number;
  reviewTests?: boolean;
  reviewSecurity?: boolean;
  logger?: ReviewLogger;
  github?: GitHubPort;
  aiProvider?: AIProvider;
  playbook?: ReviewPlaybook;
  memory?: ReviewMemory;
  persistMemory?: boolean;
}

export interface PullRequestReview {
  summary: string;
  score: number;
  riskLevel: RiskLevel;
  statistics: ReviewStatistics;
  findings: ReviewFinding[];
  positiveObservations: string[];
  testingAssessment: TestingAssessment;
  sensitiveAreas: string[];
  manualReviewAreas: string[];
  recommendation: Recommendation;
  metadata: ReviewMetadata;
}

export interface PullRequestRef {
  owner: string;
  repo: string;
  pullRequestNumber: number;
}

export interface PullRequestCommit {
  sha: string;
  message: string;
  author: string;
}

export interface PullRequestFile {
  filename: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  previousFilename?: string;
}

export interface PullRequestData {
  number: number;
  title: string;
  description: string;
  author: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  baseBranch: string;
  headBranch: string;
  headSha: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  mergeable: boolean | null;
  files: PullRequestFile[];
  commits: PullRequestCommit[];
}

export interface AIProviderConfig {
  apiKey: string;
  model?: string;
  baseURL?: string;
  maxRetries?: number;
}

export interface ReviewLogger {
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, extra?: Record<string, unknown>): void;
}

export interface GitHubPort {
  getPullRequest(ref: PullRequestRef): Promise<PullRequestData>;
  listIssueComments(ref: PullRequestRef): Promise<GitHubComment[]>;
  createIssueComment(ref: PullRequestRef, body: string): Promise<GitHubComment>;
  updateIssueComment(ref: PullRequestRef, commentId: number, body: string): Promise<GitHubComment>;
  createReview(input: CreateReviewInput): Promise<void>;
  getDefaultBranch(owner: string, repo: string): Promise<string>;
  getFileContent(owner: string, repo: string, path: string, ref: string): Promise<string | undefined>;
  listSourcePaths(owner: string, repo: string, ref: string): Promise<string[]>;
  listReviewComments(ref: PullRequestRef): Promise<GitHubComment[]>;
  findMemoryIssue(owner: string, repo: string): Promise<{ id: number; body: string } | undefined>;
  upsertMemoryIssue(owner: string, repo: string, body: string, issueId?: number): Promise<{ id: number }>;
}

export interface GitHubComment {
  id: number;
  body: string;
  user: string;
  thumbsUp: number;
  thumbsDown: number;
  path?: string;
}

export interface CreateReviewInput {
  ref: PullRequestRef;
  commitId: string;
  body: string;
  event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
  comments: InlineReviewComment[];
}

export interface InlineReviewComment {
  path: string;
  line: number;
  body: string;
}

export interface AIChunkReview {
  summary: string;
  findings: DraftFinding[];
  positiveObservations: string[];
  testingAssessment: TestingAssessment;
  sensitiveAreas: string[];
  manualReviewAreas: string[];
  recommendation: Recommendation;
  insufficientContext: boolean;
}

export interface AIReviewContext {
  pullRequest: PullRequestData;
  files: PullRequestFile[];
  commits: PullRequestCommit[];
  playbook?: ReviewPlaybook;
  memory?: ReviewMemory;
  relatedFiles?: RelatedContextFile[];
}

export interface RelatedContextFile {
  path: string;
  content: string;
  relation: "import" | "consumer";
  via: string;
  depth: number;
}

export interface AIProvider {
  reviewChunk(context: AIReviewContext, tools: ReviewToolExecutor): Promise<AIChunkReview>;
}

export interface ReviewToolExecutor {
  execute(name: string, args: Record<string, unknown>): Promise<unknown>;
  definitions(): ToolDefinition[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type SeverityThreshold = Severity;

export const SEVERITY_ORDER: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export const CONFIDENCE_ORDER: Record<Confidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
};
