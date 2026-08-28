import { aiChunkReviewSchema } from "../schemas/review.js";
import type { AIChunkReview } from "../types/index.js";

export function extractJson(content: string): string | undefined {
  const trimmed = content.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return trimmed.slice(first, last + 1);
  }
  return undefined;
}

export function parseAndValidateChunkReview(
  content: string,
): { success: true; data: AIChunkReview } | { success: false; error: string } {
  const json = extractJson(content);
  if (!json) {
    return { success: false, error: "Response was not valid JSON." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "JSON parse error",
    };
  }
  const result = aiChunkReviewSchema.safeParse(parsed);
  if (!result.success) {
    return { success: false, error: result.error.message };
  }
  return { success: true, data: result.data };
}

export function repairLoop<T>(
  attempts: Array<() => { success: true; data: T } | { success: false; error: string }>,
  maxRetries: number,
): { ok: true; data: T; retries: number } | { ok: false; error: string; retries: number } {
  const limit = Math.min(attempts.length, maxRetries + 1);
  let lastError = "No attempts";
  for (let i = 0; i < limit; i += 1) {
    const attempt = attempts[i];
    if (!attempt) {
      break;
    }
    const result = attempt();
    if (result.success) {
      return { ok: true, data: result.data, retries: i };
    }
    lastError = result.error;
  }
  return { ok: false, error: lastError, retries: Math.max(0, limit - 1) };
}
