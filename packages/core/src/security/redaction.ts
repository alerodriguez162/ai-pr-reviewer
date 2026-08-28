export interface SecretRedactionResult {
  text: string;
  redactedCount: number;
}

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "openai", pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { name: "github_pat", pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { name: "github_token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
  { name: "aws_access_key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "aws_secret", pattern: /\b(?:aws)?[_-]?secret[_-]?access[_-]?key['"]?\s*[:=]\s*['"]?[A-Za-z0-9/+=]{30,}['"]?/gi },
  { name: "private_key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { name: "slack", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: "password_assignment", pattern: /\b(?:password|passwd|pwd|secret)\s*[:=]\s*['"][^'"]{6,}['"]/gi },
  { name: "basic_auth_url", pattern: /https?:\/\/[^/\s:@]+:[^/\s:@]+@/gi },
];

const PLACEHOLDER = "[REDACTED_SECRET]";

export function redactSecrets(input: string): SecretRedactionResult {
  let text = input;
  let redactedCount = 0;

  for (const { pattern } of SECRET_PATTERNS) {
    const globalPattern = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    text = text.replace(globalPattern, () => {
      redactedCount += 1;
      return PLACEHOLDER;
    });
  }

  return { text, redactedCount };
}

export function redactSecretsInObject<T>(value: T): T {
  if (typeof value === "string") {
    return redactSecrets(value).text as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecretsInObject(item)) as T;
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = redactSecretsInObject(nested);
    }
    return output as T;
  }
  return value;
}
