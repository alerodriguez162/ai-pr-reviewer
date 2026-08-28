import type {
  FindingCategory,
  GitHubComment,
  ReviewFinding,
  ReviewMemory,
  ReviewMemoryEntry,
  ReviewPlaybook,
} from "../types/index.js";
import { SEVERITY_ORDER } from "../types/index.js";

export const MEMORY_ISSUE_TITLE = "[ai-pr-reviewer] Review memory";
export const MEMORY_MARKER = "<!-- ai-pr-reviewer-memory -->";

const FEEDBACK_LINE =
  /^\s*ai-review\s+(ignore|skip|false-positive|unhelpful|-|keep|useful|helpful|\+)\s*:\s*(.+)$/i;

function isReviewerMetaComment(body: string): boolean {
  return body.includes("<!-- ai-pr-reviewer -->") || body.includes(MEMORY_MARKER);
}

export function findingFingerprint(finding: { category: string; title: string }): string {
  return `${finding.category}:${slug(finding.title)}`;
}

export function findingMarker(fingerprint: string): string {
  return `<!-- finding-fp:${fingerprint} -->`;
}

export function extractFingerprint(body: string): string | undefined {
  const match = /<!-- finding-fp:([a-z0-9_:-]+) -->/i.exec(body);
  return match?.[1];
}

export function serializeMemory(memory: ReviewMemory): string {
  return `${MEMORY_MARKER}\n\nThis issue is maintained by AI PR Reviewer. Do not edit by hand unless you know the format.\n\n\`\`\`json\n${JSON.stringify(memory, null, 2)}\n\`\`\`\n`;
}

export function parseMemory(body: string): ReviewMemory {
  const fenced = /```json\s*([\s\S]*?)```/i.exec(body);
  const raw = fenced?.[1] ?? body;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !("entries" in parsed) || !Array.isArray(parsed.entries)) {
      return { entries: [] };
    }
    return { entries: parsed.entries.filter(isMemoryEntry) };
  } catch {
    return { entries: [] };
  }
}

export function harvestFeedback(comments: GitHubComment[]): ReviewMemoryEntry[] {
  const harvested: ReviewMemoryEntry[] = [];
  const now = new Date().toISOString();

  for (const comment of comments) {
    if (isReviewerMetaComment(comment.body)) {
      continue;
    }
    const fingerprint = extractFingerprint(comment.body);
    if (fingerprint) {
      const verdict = verdictFromReactions(comment);
      if (verdict) {
        harvested.push({
          fingerprint,
          category: categoryFromFingerprint(fingerprint),
          title: titleFromFingerprint(fingerprint),
          file: comment.path,
          verdict,
          count: 1,
          updatedAt: now,
        });
      }
    }

    for (const line of comment.body.split("\n")) {
      const match = FEEDBACK_LINE.exec(line.trim());
      if (!match || !match[1] || !match[2]) {
        continue;
      }
      const command = match[1].toLowerCase();
      const target = match[2].trim();
      const fp = target.includes(":") ? slugFingerprint(target) : `unknown:${slug(target)}`;
      harvested.push({
        fingerprint: fp,
        category: categoryFromFingerprint(fp),
        title: titleFromFingerprint(fp),
        verdict: isUnhelpfulCommand(command) ? "unhelpful" : "helpful",
        count: 1,
        updatedAt: now,
      });
    }
  }

  return harvested;
}

export function mergeMemory(base: ReviewMemory, incoming: ReviewMemoryEntry[]): ReviewMemory {
  const map = new Map<string, ReviewMemoryEntry>();
  for (const entry of base.entries) {
    map.set(memoryKey(entry), { ...entry });
  }
  for (const entry of incoming) {
    const key = memoryKey(entry);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...entry });
      continue;
    }
    if (existing.verdict === entry.verdict) {
      existing.count += entry.count;
      existing.updatedAt = entry.updatedAt;
    } else if (entry.count >= existing.count) {
      map.set(key, { ...entry, count: entry.count });
    }
  }
  return { entries: [...map.values()].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)) };
}

export function applyLearning(
  findings: ReviewFinding[],
  playbook: ReviewPlaybook,
  memory: ReviewMemory,
): { findings: ReviewFinding[]; suppressed: ReviewFinding[] } {
  const suppressed: ReviewFinding[] = [];
  const kept: ReviewFinding[] = [];

  for (const finding of findings) {
    if (shouldKeepDespiteFeedback(finding) === false && isSuppressed(finding, playbook, memory)) {
      suppressed.push(finding);
      continue;
    }
    kept.push(finding);
  }

  return { findings: kept, suppressed };
}

function isSuppressed(
  finding: ReviewFinding,
  playbook: ReviewPlaybook,
  memory: ReviewMemory,
): boolean {
  if (playbook.ignoreCategories.includes(finding.category)) {
    return true;
  }
  if (finding.file && playbook.ignorePaths.some((pattern) => pathMatches(finding.file ?? "", pattern))) {
    return true;
  }
  if (playbook.ignoreTitles.some((title) => slug(finding.title).includes(slug(title)) || slug(title).includes(slug(finding.title)))) {
    return true;
  }
  const fp = findingFingerprint(finding);
  return memory.entries.some(
    (entry) => entry.verdict === "unhelpful" && (entry.fingerprint === fp || similarFingerprint(entry.fingerprint, fp)),
  );
}

function shouldKeepDespiteFeedback(finding: ReviewFinding): boolean {
  return finding.category === "security" && SEVERITY_ORDER[finding.severity] >= SEVERITY_ORDER.critical;
}

function verdictFromReactions(comment: GitHubComment): ReviewMemoryEntry["verdict"] | undefined {
  if (comment.thumbsDown > comment.thumbsUp && comment.thumbsDown > 0) {
    return "unhelpful";
  }
  if (comment.thumbsUp > comment.thumbsDown && comment.thumbsUp > 0) {
    return "helpful";
  }
  return undefined;
}

function isUnhelpfulCommand(command: string): boolean {
  return ["ignore", "skip", "false-positive", "unhelpful", "-"].includes(command);
}

function categoryFromFingerprint(fingerprint: string): FindingCategory {
  const category = fingerprint.split(":")[0];
  switch (category) {
    case "bug":
    case "security":
    case "performance":
    case "maintainability":
    case "code_quality":
    case "testing":
    case "regression":
      return category;
    default:
      return "code_quality";
  }
}

function titleFromFingerprint(fingerprint: string): string {
  const parts = fingerprint.split(":");
  return (parts[1] ?? fingerprint).replace(/-/g, " ");
}

function slugFingerprint(value: string): string {
  const [category, ...rest] = value.split(":");
  if (rest.length === 0 || !category) {
    return `unknown:${slug(value)}`;
  }
  return `${category}:${slug(rest.join(":"))}`;
}

function similarFingerprint(a: string, b: string): boolean {
  const left = a.split(":")[1] ?? a;
  const right = b.split(":")[1] ?? b;
  return a.split(":")[0] === b.split(":")[0] && (left.includes(right) || right.includes(left));
}

function memoryKey(entry: ReviewMemoryEntry): string {
  return `${entry.verdict}:${entry.fingerprint}`;
}

function pathMatches(file: string, pattern: string): boolean {
  if (pattern.endsWith("/**")) {
    return file.startsWith(pattern.slice(0, -3));
  }
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(file);
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function isMemoryEntry(value: unknown): value is ReviewMemoryEntry {
  if (!value || typeof value !== "object") {
    return false;
  }
  const entry = value as Partial<ReviewMemoryEntry>;
  return (
    typeof entry.fingerprint === "string" &&
    typeof entry.title === "string" &&
    (entry.verdict === "helpful" || entry.verdict === "unhelpful") &&
    typeof entry.count === "number"
  );
}
