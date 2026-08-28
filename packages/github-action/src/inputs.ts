import type { Severity } from "@larva-factory/ai-pr-reviewer";

export interface ActionInputs {
  githubToken: string;
  openaiApiKey: string;
  severityThreshold: Severity;
  postReview: boolean;
  failOnSeverity: Severity;
  model?: string;
  maxFiles?: number;
  maxDiffSize?: number;
  reviewTests: boolean;
  reviewSecurity: boolean;
}

export interface ActionOutputs {
  score: string;
  "risk-level": string;
  recommendation: string;
  "findings-count": string;
  "critical-findings": string;
  "high-findings": string;
}

export interface InputReader {
  getInput(name: string, options?: { required?: boolean }): string;
  getBooleanInput(name: string): boolean;
}

const SEVERITIES: Severity[] = ["info", "low", "medium", "high", "critical"];

export function parseSeverity(value: string, fallback: Severity): Severity {
  const normalized = value.trim().toLowerCase();
  return SEVERITIES.includes(normalized as Severity) ? (normalized as Severity) : fallback;
}

export function parseActionInputs(core: InputReader): ActionInputs {
  const maxFilesRaw = core.getInput("max-files");
  const maxDiffRaw = core.getInput("max-diff-size");
  return {
    githubToken: core.getInput("github-token", { required: true }),
    openaiApiKey: core.getInput("openai-api-key", { required: true }),
    severityThreshold: parseSeverity(core.getInput("severity-threshold") || "medium", "medium"),
    postReview: parseBoolean(core, "post-review", true),
    failOnSeverity: parseSeverity(core.getInput("fail-on-severity") || "critical", "critical"),
    model: core.getInput("model") || undefined,
    maxFiles: maxFilesRaw ? Number(maxFilesRaw) : undefined,
    maxDiffSize: maxDiffRaw ? Number(maxDiffRaw) : undefined,
    reviewTests: parseBoolean(core, "review-tests", true),
    reviewSecurity: parseBoolean(core, "review-security", true),
  };
}

function parseBoolean(core: InputReader, name: string, fallback: boolean): boolean {
  const raw = core.getInput(name);
  if (!raw) {
    return fallback;
  }
  return raw === "true" || raw === "True" || raw === "TRUE";
}

export function buildActionOutputs(input: {
  score: number;
  riskLevel: string;
  recommendation: string;
  findingsCount: number;
  criticalFindings: number;
  highFindings: number;
}): ActionOutputs {
  return {
    score: String(input.score),
    "risk-level": input.riskLevel,
    recommendation: input.recommendation,
    "findings-count": String(input.findingsCount),
    "critical-findings": String(input.criticalFindings),
    "high-findings": String(input.highFindings),
  };
}
