import type {
  Confidence,
  GitHubPort,
  InlineReviewComment,
  PullRequestData,
  PullRequestRef,
  PullRequestReview,
  ReviewFinding,
  Severity,
} from "../types/index.js";
import { CONFIDENCE_ORDER, SEVERITY_ORDER } from "../types/index.js";
import { isChangedLine } from "./diff.js";
import { formatReviewMarkdown } from "../review/formatter.js";
import { findingFingerprint, findingMarker } from "../review/memory.js";

export const REVIEW_COMMENT_MARKER = "<!-- ai-pr-reviewer -->";

export interface PublishOptions {
  postReview: boolean;
  severityThreshold: Severity;
  confidenceThreshold?: Confidence;
  inlineComments?: boolean;
}

export class GitHubReviewPublisher {
  constructor(private readonly github: GitHubPort) {}

  async publish(
    ref: PullRequestRef,
    pullRequest: PullRequestData,
    review: PullRequestReview,
    options: PublishOptions,
  ): Promise<{ commentId: number | null; inlineCount: number }> {
    if (!options.postReview) {
      return { commentId: null, inlineCount: 0 };
    }

    const body = `${REVIEW_COMMENT_MARKER}\n${formatReviewMarkdown(review)}`;
    const existing = await this.findExistingComment(ref);
    const saved = existing
      ? await this.github.updateIssueComment(ref, existing.id, body)
      : await this.github.createIssueComment(ref, body);

    let inlineCount = 0;
    if (options.inlineComments !== false) {
      const comments = this.selectInlineComments(pullRequest, review, options);
      if (comments.length > 0) {
        await this.github.createReview({
          ref,
          commitId: pullRequest.headSha,
          body: "Inline findings from AI PR Reviewer. See the summary comment for the full review.",
          event: "COMMENT",
          comments,
        });
        inlineCount = comments.length;
      }
    }

    return { commentId: saved.id, inlineCount };
  }

  async findExistingComment(ref: PullRequestRef): Promise<{ id: number } | undefined> {
    const comments = await this.github.listIssueComments(ref);
    const match = comments.find((comment) => comment.body.includes(REVIEW_COMMENT_MARKER));
    return match ? { id: match.id } : undefined;
  }

  selectInlineComments(
    pullRequest: PullRequestData,
    review: PullRequestReview,
    options: PublishOptions,
  ): InlineReviewComment[] {
    const minSeverity = SEVERITY_ORDER[options.severityThreshold];
    const minConfidence = CONFIDENCE_ORDER[options.confidenceThreshold ?? "medium"];
    const comments: InlineReviewComment[] = [];

    for (const finding of review.findings) {
      if (SEVERITY_ORDER[finding.severity] < minSeverity) {
        continue;
      }
      if (CONFIDENCE_ORDER[finding.confidence] < minConfidence) {
        continue;
      }
      if (!finding.file || !finding.line) {
        continue;
      }
      const file = pullRequest.files.find((item) => item.filename === finding.file);
      if (!file || !isChangedLine(file, finding.line)) {
        continue;
      }
      comments.push({
        path: finding.file,
        line: finding.line,
        body: formatInlineFinding(finding),
      });
      if (comments.length >= 8) {
        break;
      }
    }

    return comments;
  }
}

function formatInlineFinding(finding: ReviewFinding): string {
  const fingerprint = findingFingerprint(finding);
  return [
    findingMarker(fingerprint),
    `**${finding.severity.toUpperCase()}** (${finding.category}) — ${finding.title}`,
    "",
    finding.description,
    finding.suggestion ? `\nSuggested action: ${finding.suggestion}` : "",
    `\nConfidence: ${finding.confidence}`,
    "",
    "_AI-generated finding. Verify manually. React 👍/👎 to train the next review._",
  ]
    .filter(Boolean)
    .join("\n");
}
