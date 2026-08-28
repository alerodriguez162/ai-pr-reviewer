import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import OpenAI from "openai";
import {
  AIProviderError,
  AIRateLimitError,
  MalformedAIResponseError,
} from "../errors/index.js";
import { buildRepairPrompt, buildSystemPrompt, buildUserPrompt } from "./prompts.js";
import { parseAndValidateChunkReview } from "./validate.js";
import type {
  AIChunkReview,
  AIProvider,
  AIProviderConfig,
  AIReviewContext,
  ReviewLogger,
  ReviewToolExecutor,
  TokenUsage,
} from "../types/index.js";

const DEFAULT_MODEL = "gpt-4o-mini";
const MAX_TOOL_ROUNDS = 8;
const MAX_SCHEMA_RETRIES = 2;

export class OpenAIProvider implements AIProvider {
  readonly lastUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  readonly model: string;
  private readonly client: OpenAI;
  private readonly logger?: ReviewLogger;

  constructor(config: AIProviderConfig, logger?: ReviewLogger) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      maxRetries: config.maxRetries ?? 2,
    });
    this.model = config.model ?? process.env.OPENAI_MODEL ?? DEFAULT_MODEL;
    this.logger = logger;
  }

  async reviewChunk(context: AIReviewContext, tools: ReviewToolExecutor): Promise<AIChunkReview> {
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: buildSystemPrompt(context) },
      { role: "user", content: buildUserPrompt(context) },
    ];

    const openaiTools: ChatCompletionTool[] = tools.definitions().map((definition) => ({
      type: "function",
      function: {
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters,
      },
    }));

    let schemaAttempts = 0;

    for (let round = 0; round < MAX_TOOL_ROUNDS + MAX_SCHEMA_RETRIES + 1; round += 1) {
      const completion = await this.createCompletion(messages, openaiTools);
      const choice = completion.choices[0];
      const message = choice?.message;
      if (!message) {
        throw new AIProviderError("The AI provider returned an empty response.");
      }

      if (message.tool_calls && message.tool_calls.length > 0) {
        messages.push(message);
        for (const call of message.tool_calls) {
          const args = parseArgs(call.function.arguments);
          const result = await tools.execute(call.function.name, args);
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result),
          });
        }
        continue;
      }

      const content = message.content ?? "";
      const parsed = parseAndValidateChunkReview(content);
      if (parsed.success) {
        return parsed.data;
      }

      schemaAttempts += 1;
      if (schemaAttempts > MAX_SCHEMA_RETRIES) {
        throw new MalformedAIResponseError(
          `The AI response could not be validated after ${MAX_SCHEMA_RETRIES} repair attempts.`,
        );
      }
      this.logger?.warn("Malformed AI response; requesting repair.", {
        attempt: schemaAttempts,
      });
      messages.push(message);
      messages.push({
        role: "user",
        content: buildRepairPrompt(parsed.error),
      });
    }

    throw new MalformedAIResponseError("The AI did not produce a valid review in time.");
  }

  private async createCompletion(
    messages: ChatCompletionMessageParam[],
    tools: ChatCompletionTool[],
  ) {
    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.1,
      });
      const usage = completion.usage;
      if (usage) {
        this.lastUsage.promptTokens += usage.prompt_tokens;
        this.lastUsage.completionTokens += usage.completion_tokens;
        this.lastUsage.totalTokens += usage.total_tokens;
      }
      return completion;
    } catch (error) {
      if (isRateLimit(error)) {
        throw new AIRateLimitError();
      }
      const message = error instanceof Error ? error.message : "AI provider request failed.";
      throw new AIProviderError(message.replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]"));
    }
  }
}

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function isRateLimit(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const status = "status" in error ? error.status : undefined;
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  return status === 429 || /rate limit/i.test(message);
}
