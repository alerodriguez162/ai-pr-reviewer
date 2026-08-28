import type { ReviewLogger } from "../types/index.js";

const SENSITIVE_KEY_PATTERN =
  /(token|secret|password|authorization|api[_-]?key|credential)/i;

function isSensitive(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

function redactExtra(
  extra?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!extra) {
    return extra;
  }
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extra)) {
    if (isSensitive(key)) {
      redacted[key] = "[REDACTED]";
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

export function createLogger(prefix = "[AI PR Reviewer]"): ReviewLogger {
  return {
    info(message, extra) {
      if (extra) {
        console.log(`${prefix} ${message}`, redactExtra(extra));
      } else {
        console.log(`${prefix} ${message}`);
      }
    },
    warn(message, extra) {
      if (extra) {
        console.warn(`${prefix} ${message}`, redactExtra(extra));
      } else {
        console.warn(`${prefix} ${message}`);
      }
    },
    error(message, extra) {
      if (extra) {
        console.error(`${prefix} ${message}`, redactExtra(extra));
      } else {
        console.error(`${prefix} ${message}`);
      }
    },
  };
}

export const silentLogger: ReviewLogger = {
  info() {},
  warn() {},
  error() {},
};
