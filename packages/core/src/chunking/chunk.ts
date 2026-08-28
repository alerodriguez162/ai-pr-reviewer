import { isGeneratedFile, isLockfile, isTestFile } from "../security/generated.js";
import { isSensitivePath } from "../security/sensitive.js";
import type { PullRequestFile } from "../types/index.js";

export interface ChunkingOptions {
  maxFiles: number;
  maxPatchChars: number;
  maxChunkChars: number;
}

export interface FileClassification {
  file: PullRequestFile;
  generated: boolean;
  lockfile: boolean;
  test: boolean;
  sensitive: boolean;
  reviewable: boolean;
}

export interface ReviewChunk {
  index: number;
  files: PullRequestFile[];
  truncatedFiles: string[];
}

export interface ChunkPlan {
  classifications: FileClassification[];
  chunks: ReviewChunk[];
  skippedGenerated: PullRequestFile[];
  skippedOversized: PullRequestFile[];
  skippedOverflow: PullRequestFile[];
}

const DEFAULTS: ChunkingOptions = {
  maxFiles: 40,
  maxPatchChars: 8000,
  maxChunkChars: 24000,
};

export function classifyFiles(files: PullRequestFile[]): FileClassification[] {
  return files.map((file) => {
    const generated = isGeneratedFile(file.filename, file.patch);
    const lockfile = isLockfile(file.filename);
    const test = isTestFile(file.filename);
    const sensitive = isSensitivePath(file.filename);
    return {
      file,
      generated,
      lockfile,
      test,
      sensitive,
      reviewable: !generated,
    };
  });
}

export function planChunks(
  files: PullRequestFile[],
  options: Partial<ChunkingOptions> = {},
): ChunkPlan {
  const opts = { ...DEFAULTS, ...options };
  const classifications = classifyFiles(files);
  const skippedGenerated = classifications.filter((item) => item.generated).map((item) => item.file);

  const reviewable = classifications
    .filter((item) => item.reviewable)
    .sort((a, b) => {
      if (a.sensitive !== b.sensitive) {
        return a.sensitive ? -1 : 1;
      }
      return b.file.changes - a.file.changes;
    });

  const skippedOversized: PullRequestFile[] = [];
  const prepared: Array<{ file: PullRequestFile; truncated: boolean }> = [];

  for (const item of reviewable) {
    const patch = item.file.patch;
    if (patch && patch.length > opts.maxPatchChars * 4) {
      skippedOversized.push(item.file);
      continue;
    }
    if (patch && patch.length > opts.maxPatchChars) {
      prepared.push({
        file: {
          ...item.file,
          patch: `${patch.slice(0, opts.maxPatchChars)}\n\n[diff truncated for size]`,
        },
        truncated: true,
      });
    } else {
      prepared.push({ file: item.file, truncated: false });
    }
  }

  const limited = prepared.slice(0, opts.maxFiles);
  const skippedOverflow = prepared.slice(opts.maxFiles).map((item) => item.file);

  const chunks: ReviewChunk[] = [];
  let current: ReviewChunk = { index: 0, files: [], truncatedFiles: [] };
  let currentSize = 0;

  const flush = (): void => {
    if (current.files.length === 0) {
      return;
    }
    chunks.push(current);
    current = { index: chunks.length, files: [], truncatedFiles: [] };
    currentSize = 0;
  };

  for (const item of limited) {
    const size = item.file.patch?.length ?? item.file.filename.length;
    if (current.files.length > 0 && currentSize + size > opts.maxChunkChars) {
      flush();
    }
    current.files.push(item.file);
    if (item.truncated) {
      current.truncatedFiles.push(item.file.filename);
    }
    currentSize += size;
  }
  flush();

  return {
    classifications,
    chunks,
    skippedGenerated,
    skippedOversized,
    skippedOverflow,
  };
}

export { isTestFile };
