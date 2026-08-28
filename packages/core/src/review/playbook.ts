import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { findingCategorySchema } from "../schemas/review.js";
import { DEFAULT_CONTEXT_CONFIG, type ReviewContextConfig as ResolvedReviewContextConfig } from "../context/expansion.js";
import type { ReviewContextConfig, ReviewPlaybook } from "../types/index.js";

export const PLAYBOOK_PATHS = [
  ".ai-pr-reviewer.yml",
  ".ai-pr-reviewer.yaml",
  ".github/ai-pr-reviewer.yml",
] as const;

const playbookFileSchema = z
  .object({
    focus: z.array(z.string().max(300)).max(30).optional(),
    ignore: z
      .object({
        categories: z.array(findingCategorySchema).max(10).optional(),
        paths: z.array(z.string().max(200)).max(50).optional(),
        titles: z.array(z.string().max(200)).max(50).optional(),
      })
      .optional(),
    style: z.string().max(1000).optional(),
    domainNotes: z.array(z.string().max(500)).max(40).optional(),
    domain: z.array(z.string().max(500)).max(40).optional(),
    context: z
      .object({
        enabled: z.boolean().optional(),
        maxDepth: z.number().int().min(0).max(5).optional(),
        maxFiles: z.number().int().min(1).max(100).optional(),
        maxFileChars: z.number().int().min(1000).max(50000).optional(),
        followImports: z.boolean().optional(),
        findConsumers: z.boolean().optional(),
        includePaths: z.array(z.string().max(200)).max(50).optional(),
        excludePaths: z.array(z.string().max(200)).max(50).optional(),
        consumerScanLimit: z.number().int().min(10).max(500).optional(),
      })
      .optional(),
  })
  .passthrough();

export const EMPTY_PLAYBOOK: ReviewPlaybook = {
  focus: [],
  ignoreCategories: [],
  ignorePaths: [],
  ignoreTitles: [],
  domainNotes: [],
};

export function resolveContextConfig(playbook: ReviewPlaybook): ResolvedReviewContextConfig {
  const context = playbook.context;
  return {
    enabled: context?.enabled ?? DEFAULT_CONTEXT_CONFIG.enabled,
    maxDepth: context?.maxDepth ?? DEFAULT_CONTEXT_CONFIG.maxDepth,
    maxFiles: context?.maxFiles ?? DEFAULT_CONTEXT_CONFIG.maxFiles,
    maxFileChars: context?.maxFileChars ?? DEFAULT_CONTEXT_CONFIG.maxFileChars,
    followImports: context?.followImports ?? DEFAULT_CONTEXT_CONFIG.followImports,
    findConsumers: context?.findConsumers ?? DEFAULT_CONTEXT_CONFIG.findConsumers,
    includePaths: context?.includePaths ?? DEFAULT_CONTEXT_CONFIG.includePaths,
    excludePaths: context?.excludePaths ?? DEFAULT_CONTEXT_CONFIG.excludePaths,
    consumerScanLimit: context?.consumerScanLimit ?? DEFAULT_CONTEXT_CONFIG.consumerScanLimit,
  };
}

export function parsePlaybook(raw: string): ReviewPlaybook {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch {
    return EMPTY_PLAYBOOK;
  }
  const result = playbookFileSchema.safeParse(parsed ?? {});
  if (!result.success) {
    return EMPTY_PLAYBOOK;
  }
  const file = result.data;
  return {
    focus: file.focus ?? [],
    ignoreCategories: file.ignore?.categories ?? [],
    ignorePaths: file.ignore?.paths ?? [],
    ignoreTitles: file.ignore?.titles ?? [],
    style: file.style,
    domainNotes: [...(file.domainNotes ?? []), ...(file.domain ?? [])],
    context: file.context as ReviewContextConfig | undefined,
  };
}

export function isPlaybookEmpty(playbook: ReviewPlaybook): boolean {
  return (
    playbook.focus.length === 0 &&
    playbook.ignoreCategories.length === 0 &&
    playbook.ignorePaths.length === 0 &&
    playbook.ignoreTitles.length === 0 &&
    playbook.domainNotes.length === 0 &&
    !playbook.style &&
    !playbook.context?.enabled
  );
}
