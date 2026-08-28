import type { GitHubPort, PullRequestData, ReviewLogger, ReviewPlaybook } from "../types/index.js";
import { classifyFiles } from "../chunking/chunk.js";
import { isGeneratedFile } from "../security/generated.js";
import { redactSecrets } from "../security/redaction.js";
import { resolveContextConfig } from "../review/playbook.js";
import { extractImportSpecifiers, resolveImportToFilePath } from "./imports.js";
import {
  discoverConsumers,
  isEligibleContextPath,
  planImportExpansion,
  truncateContextContent,
  type RelatedContextFile,
} from "./expansion.js";

export interface LoadedReviewContext {
  files: RelatedContextFile[];
  truncated: boolean;
}

export async function loadRelatedContext(
  github: GitHubPort,
  owner: string,
  repo: string,
  pullRequest: PullRequestData,
  playbook: ReviewPlaybook,
  logger: ReviewLogger,
): Promise<LoadedReviewContext> {
  const config = resolveContextConfig(playbook);
  if (!config.enabled) {
    return { files: [], truncated: false };
  }

  const reviewableSeeds = classifyFiles(pullRequest.files)
    .filter((item) => item.reviewable && !item.lockfile)
    .map((item) => item.file.filename);

  if (reviewableSeeds.length === 0) {
    return { files: [], truncated: false };
  }

  try {
    const [allPaths, seedContents] = await Promise.all([
      github.listSourcePaths(owner, repo, pullRequest.headSha),
      fetchContents(github, owner, repo, pullRequest.headSha, reviewableSeeds, config.maxFileChars),
    ]);

    const knownPaths = new Set(allPaths.filter((path) => isEligibleContextPath(path, config)));
    const mergedContents = new Map(seedContents);
    const imports: Array<{ path: string; via: string; depth: number }> = [];
    let truncated = false;

    if (config.followImports) {
      const queue = reviewableSeeds.map((path) => ({ path, depth: 0 }));
      const visited = new Set(reviewableSeeds);

      while (queue.length > 0) {
        const current = queue.shift()!;
        const content = mergedContents.get(current.path);
        if (!content || current.depth >= config.maxDepth) {
          continue;
        }

        for (const specifier of extractImportSpecifiers(content)) {
          const resolved = resolveImportToFilePath(current.path, specifier, knownPaths);
          if (!resolved || visited.has(resolved)) {
            continue;
          }
          if (imports.length + reviewableSeeds.length >= config.maxFiles) {
            truncated = true;
            break;
          }

          visited.add(resolved);
          imports.push({ path: resolved, via: current.path, depth: current.depth + 1 });
          queue.push({ path: resolved, depth: current.depth + 1 });

          if (!mergedContents.has(resolved)) {
            const raw = await github.getFileContent(owner, repo, resolved, pullRequest.headSha);
            if (raw !== undefined) {
              mergedContents.set(
                resolved,
                truncateContextContent(redactSecrets(raw).text, config.maxFileChars),
              );
            }
          }
        }

        if (truncated) {
          break;
        }
      }
    }

    const importPlan = planImportExpansion(reviewableSeeds, mergedContents, allPaths, config);

    const consumerCandidateContents = await fetchContents(
      github,
      owner,
      repo,
      pullRequest.headSha,
      importPlan.consumerCandidates,
      config.maxFileChars,
    );

    const consumerResult = discoverConsumers(
      reviewableSeeds,
      imports.map((item) => item.path),
      new Map([...mergedContents, ...consumerCandidateContents]),
      importPlan.consumerCandidates,
      allPaths,
      config,
    );

    const related: RelatedContextFile[] = [
      ...imports
        .filter((item) => mergedContents.has(item.path))
        .map((item) => ({
          path: item.path,
          content: mergedContents.get(item.path)!,
          relation: "import" as const,
          via: item.via,
          depth: item.depth,
        })),
      ...consumerResult.consumers
        .filter((item) => consumerCandidateContents.has(item.path))
        .map((item) => ({
          path: item.path,
          content: consumerCandidateContents.get(item.path)!,
          relation: "consumer" as const,
          via: item.via,
          depth: 1,
        })),
    ];

    const truncatedFinal = truncated || importPlan.truncated || consumerResult.truncated;
    if (related.length > 0) {
      logger.info(
        `Loaded ${related.length} related context files (${related.filter((file) => file.relation === "import").length} imports, ${related.filter((file) => file.relation === "consumer").length} consumers).`,
      );
    }
    if (truncatedFinal) {
      logger.warn("Related context expansion hit file limits; some dependencies or consumers were omitted.");
    }

    return { files: related, truncated: truncatedFinal };
  } catch {
    logger.warn("Could not load related repository context; continuing with diff only.");
    return { files: [], truncated: false };
  }
}

async function fetchContents(
  github: GitHubPort,
  owner: string,
  repo: string,
  ref: string,
  paths: string[],
  maxFileChars: number,
): Promise<Map<string, string>> {
  const contents = new Map<string, string>();
  const uniquePaths = [...new Set(paths.filter((path) => !isGeneratedFile(path)))];

  await Promise.all(
    uniquePaths.map(async (path) => {
      const raw = await github.getFileContent(owner, repo, path, ref);
      if (raw === undefined) {
        return;
      }
      const redacted = redactSecrets(raw).text;
      contents.set(path, truncateContextContent(redacted, maxFileChars));
    }),
  );

  return contents;
}
