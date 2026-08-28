import { parseArgs } from "node:util";
import { MissingConfigurationError } from "../errors/index.js";
import { toUserFacingError } from "../errors/index.js";
import { parsePullRequestUrl } from "../github/url.js";
import { createLogger } from "../logging/logger.js";
import { formatReviewPretty } from "../review/formatter.js";
import { runDemoReview } from "../review/demo.js";
import { reviewPullRequest } from "../review/engine.js";
import { SEVERITY_ORDER, type PullRequestReview, type Severity } from "../types/index.js";

export const EXIT_OK = 0;
export const EXIT_RUNTIME = 1;
export const EXIT_THRESHOLD = 2;

export interface CliOptions {
  url?: string;
  format: "pretty" | "json";
  severity: Severity;
  demo: boolean;
  help: boolean;
}

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const HELP = `AI Pull Request Reviewer

Usage:
  ai-pr-review <github-pr-url> [--format pretty|json] [--severity <level>]
  ai-pr-review --demo [--format pretty|json]
  ai-pr-review --help

Environment:
  GITHUB_TOKEN      GitHub token (never pass as a CLI flag)
  OPENAI_API_KEY    OpenAI API key (never pass as a CLI flag)

Exit codes:
  0  Review completed
  1  Runtime or configuration error
  2  Configured severity threshold exceeded
`;

export function parseCliArgs(argv: string[]): CliOptions {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      format: { type: "string", short: "f", default: "pretty" },
      severity: { type: "string", default: "medium" },
      demo: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const format = values.format === "json" ? "json" : "pretty";
  const severity = parseSeverity(values.severity ?? "medium");

  return {
    url: positionals[0],
    format,
    severity,
    demo: Boolean(values.demo),
    help: Boolean(values.help),
  };
}

export async function runCli(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<CliResult> {
  try {
    const options = parseCliArgs(argv);
    if (options.help) {
      return { exitCode: EXIT_OK, stdout: HELP, stderr: "" };
    }

    if (options.demo) {
      const { review } = await runDemoReview();
      return present(review, options, { enforceThreshold: false });
    }

    if (!options.url) {
      return {
        exitCode: EXIT_RUNTIME,
        stdout: "",
        stderr: "A GitHub pull request URL is required. Use --help for usage.\n",
      };
    }

    const ref = parsePullRequestUrl(options.url);
    const githubToken = env.GITHUB_TOKEN;
    const apiKey = env.OPENAI_API_KEY;
    if (!githubToken) {
      throw new MissingConfigurationError("GITHUB_TOKEN is required in the environment.");
    }
    if (!apiKey) {
      throw new MissingConfigurationError("OPENAI_API_KEY is required in the environment.");
    }

    const logger = createLogger();
    const review = await reviewPullRequest({
      owner: ref.owner,
      repo: ref.repo,
      pullRequest: ref.pullRequestNumber,
      githubToken,
      ai: { apiKey, model: env.OPENAI_MODEL },
      logger,
    });
    return present(review, options, { enforceThreshold: true });
  } catch (error) {
    return {
      exitCode: EXIT_RUNTIME,
      stdout: "",
      stderr: `${toUserFacingError(error)}\n`,
    };
  }
}

export async function executeCli(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const result = await runCli(argv, env);
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  return result.exitCode;
}

function present(
  review: PullRequestReview,
  options: CliOptions,
  flags: { enforceThreshold: boolean } = { enforceThreshold: true },
): CliResult {
  const stdout =
    options.format === "json"
      ? `${JSON.stringify(review, null, 2)}\n`
      : `${formatReviewPretty(review)}\n`;
  const exceeded =
    flags.enforceThreshold && exceedsSeverityThreshold(review.findings, options.severity);
  return {
    exitCode: exceeded ? EXIT_THRESHOLD : EXIT_OK,
    stdout,
    stderr: "",
  };
}

export function exceedsSeverityThreshold(
  findings: Array<{ severity: Severity }>,
  severity: Severity,
): boolean {
  return findings.some((finding) => SEVERITY_ORDER[finding.severity] >= SEVERITY_ORDER[severity]);
}

function parseSeverity(value: string): Severity {
  const normalized = value.toLowerCase();
  if (
    normalized === "info" ||
    normalized === "low" ||
    normalized === "medium" ||
    normalized === "high" ||
    normalized === "critical"
  ) {
    return normalized;
  }
  return "medium";
}
