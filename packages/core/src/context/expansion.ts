import { isGeneratedFile } from "../security/generated.js";
import {
  extractImportSpecifiers,
  fileImportsAnyTarget,
  prioritizeConsumerCandidates,
  resolveImportToFilePath,
} from "./imports.js";

export interface ReviewContextConfig {
  enabled: boolean;
  maxDepth: number;
  maxFiles: number;
  maxFileChars: number;
  followImports: boolean;
  findConsumers: boolean;
  includePaths: string[];
  excludePaths: string[];
  consumerScanLimit: number;
}

export const DEFAULT_CONTEXT_CONFIG: ReviewContextConfig = {
  enabled: false,
  maxDepth: 2,
  maxFiles: 20,
  maxFileChars: 12000,
  followImports: true,
  findConsumers: true,
  includePaths: [],
  excludePaths: [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/.next/**",
    "**/coverage/**",
  ],
  consumerScanLimit: 80,
};

export type ContextRelation = "import" | "consumer";

export interface RelatedContextFile {
  path: string;
  content: string;
  relation: ContextRelation;
  via: string;
  depth: number;
}

export interface ContextExpansionPlan {
  imports: Array<{ path: string; via: string; depth: number }>;
  consumerCandidates: string[];
  truncated: boolean;
}

export function isEligibleContextPath(path: string, config: ReviewContextConfig): boolean {
  if (isGeneratedFile(path)) {
    return false;
  }
  if (!/\.(tsx?|jsx?|mjs|cjs|py|go|rs|java|kt)$/i.test(path)) {
    return false;
  }
  if (config.includePaths.length > 0 && !config.includePaths.some((pattern) => pathMatches(path, pattern))) {
    return false;
  }
  return !config.excludePaths.some((pattern) => pathMatches(path, pattern));
}

export function planImportExpansion(
  seedPaths: string[],
  contents: Map<string, string>,
  allPaths: string[],
  config: ReviewContextConfig,
): ContextExpansionPlan {
  const knownPaths = new Set(allPaths.filter((path) => isEligibleContextPath(path, config)));
  const selected = new Set(seedPaths);
  const imports: ContextExpansionPlan["imports"] = [];
  let truncated = false;

  if (!config.followImports) {
    return { imports, consumerCandidates: [], truncated };
  }

  const queue: Array<{ path: string; depth: number }> = seedPaths.map((path) => ({ path, depth: 0 }));
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= config.maxDepth) {
      continue;
    }
    const content = contents.get(current.path);
    if (!content) {
      continue;
    }
    for (const specifier of extractImportSpecifiers(content)) {
      const resolved = resolveImportToFilePath(current.path, specifier, knownPaths);
      if (!resolved || selected.has(resolved)) {
        continue;
      }
      if (imports.length + seedPaths.length >= config.maxFiles) {
        truncated = true;
        break;
      }
      selected.add(resolved);
      imports.push({ path: resolved, via: current.path, depth: current.depth + 1 });
      queue.push({ path: resolved, depth: current.depth + 1 });
    }
    if (truncated) {
      break;
    }
  }

  const consumerCandidates =
    config.findConsumers && !truncated
      ? prioritizeConsumerCandidates(seedPaths, knownPaths, selected, config.consumerScanLimit)
      : [];

  return { imports, consumerCandidates, truncated };
}

export function discoverConsumers(
  seedPaths: string[],
  importPaths: string[],
  contents: Map<string, string>,
  candidatePaths: string[],
  allPaths: string[],
  config: ReviewContextConfig,
): { consumers: Array<{ path: string; via: string }>; truncated: boolean } {
  const knownPaths = new Set(allPaths);
  const targets = new Set([...seedPaths, ...importPaths]);
  const selected = new Set([...seedPaths, ...importPaths]);
  const consumers: Array<{ path: string; via: string }> = [];
  let truncated = false;

  for (const candidatePath of candidatePaths) {
    if (selected.has(candidatePath)) {
      continue;
    }
    if (seedPaths.length + importPaths.length + consumers.length >= config.maxFiles) {
      truncated = true;
      break;
    }
    const content = contents.get(candidatePath);
    if (!content) {
      continue;
    }
    if (fileImportsAnyTarget(candidatePath, content, targets, knownPaths)) {
      const via = [...targets].find((target) =>
        fileImportsAnyTarget(candidatePath, content, new Set([target]), knownPaths),
      );
      consumers.push({ path: candidatePath, via: via ?? seedPaths[0] ?? candidatePath });
      selected.add(candidatePath);
    }
  }

  return { consumers, truncated };
}

export function truncateContextContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }
  return `${content.slice(0, maxChars)}\n\n[file truncated for context size]`;
}

function pathMatches(path: string, pattern: string): boolean {
  if (pattern.endsWith("/**")) {
    return path.startsWith(pattern.slice(0, -3));
  }
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`).test(path);
}
