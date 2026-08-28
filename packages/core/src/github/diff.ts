import type { PullRequestFile } from "../types/index.js";

export interface ChangedLine {
  file: string;
  line: number;
}

/**
 * Maps a unified diff patch to added/changed line numbers on the new file.
 */
export function parseChangedLines(file: PullRequestFile): number[] {
  const patch = file.patch;
  if (!patch) {
    return [];
  }

  const lines: number[] = [];
  let newLine = 0;

  for (const raw of patch.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk && hunk[1]) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("diff ") || raw.startsWith("index ")) {
      continue;
    }
    if (raw.startsWith("+")) {
      lines.push(newLine);
      newLine += 1;
      continue;
    }
    if (raw.startsWith("-")) {
      continue;
    }
    newLine += 1;
  }

  return [...new Set(lines)];
}

export function isChangedLine(file: PullRequestFile, line: number | undefined): boolean {
  if (!line) {
    return false;
  }
  return parseChangedLines(file).includes(line);
}
