import { heuristicReview } from "./heuristic.js";
import { aiChunkReviewSchema } from "../schemas/review.js";
import { MalformedAIResponseError } from "../errors/index.js";
import type { AIChunkReview, AIProvider, AIReviewContext, ReviewToolExecutor } from "../types/index.js";

export type MockAIBehavior =
  | { type: "valid"; review: AIChunkReview }
  | { type: "malformed-then-valid"; review: AIChunkReview }
  | { type: "always-malformed" }
  | { type: "from-tools" };

export class MockAIProvider implements AIProvider {
  readonly calls: Array<{ context: AIReviewContext; toolsUsed: string[] }> = [];
  malformedRemaining: number;
  schemaFailures = 0;

  constructor(private readonly behavior: MockAIBehavior) {
    this.malformedRemaining = behavior.type === "malformed-then-valid" ? 1 : 0;
  }

  async reviewChunk(context: AIReviewContext, tools: ReviewToolExecutor): Promise<AIChunkReview> {
    const toolsUsed = await this.invokeTools(context, tools);
    this.calls.push({ context, toolsUsed });

    if (this.behavior.type === "always-malformed") {
      this.schemaFailures += 1;
      throw new MalformedAIResponseError("Mock AI returned an invalid payload.");
    }

    if (this.behavior.type === "malformed-then-valid" && this.malformedRemaining > 0) {
      this.malformedRemaining -= 1;
      this.schemaFailures += 1;
      const invalid = aiChunkReviewSchema.safeParse({ summary: 1 });
      if (!invalid.success) {
        return this.behavior.review;
      }
    }

    if (this.behavior.type === "from-tools") {
      return heuristicReview(context);
    }

    return this.behavior.review;
  }

  private async invokeTools(context: AIReviewContext, tools: ReviewToolExecutor): Promise<string[]> {
    if (this.behavior.type === "always-malformed") {
      return [];
    }
    const used = [
      "get_pull_request",
      "get_pull_request_files",
      "get_pull_request_commits",
      "identify_test_files",
      "classify_sensitive_files",
    ];
    await tools.execute("get_pull_request", {});
    await tools.execute("get_pull_request_files", {});
    await tools.execute("get_pull_request_commits", {});
    await tools.execute("identify_test_files", {});
    await tools.execute("classify_sensitive_files", {});
    const first = context.files[0];
    if (first) {
      await tools.execute("get_file_patch", { path: first.filename });
      await tools.execute("analyze_file", { path: first.filename });
      used.push("get_file_patch", "analyze_file");
    }
    await tools.execute("rm", { path: "/etc/passwd" });
    return used;
  }
}
