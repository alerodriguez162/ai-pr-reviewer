import { describe, expect, it } from "vitest";
import { parseCliArgs, runCli, EXIT_OK, EXIT_RUNTIME, EXIT_THRESHOLD, exceedsSeverityThreshold } from "./run.js";

describe("CLI", () => {
  it("parses arguments", () => {
    const options = parseCliArgs([
      "https://github.com/acme/frontend/pull/153",
      "--format",
      "json",
      "--severity",
      "high",
    ]);
    expect(options.format).toBe("json");
    expect(options.severity).toBe("high");
    expect(options.url).toContain("pull/153");
  });

  it("prints help", async () => {
    const result = await runCli(["--help"]);
    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.stdout).toContain("Exit codes");
  });

  it("rejects invalid URLs", async () => {
    const result = await runCli(["https://example.com/not-a-pr"], {
      GITHUB_TOKEN: "x",
      OPENAI_API_KEY: "y",
    });
    expect(result.exitCode).toBe(EXIT_RUNTIME);
    expect(result.stderr).toMatch(/github.com/i);
  });

  it("runs demo pretty and json output", async () => {
    const pretty = await runCli(["--demo"]);
    expect(pretty.exitCode).toBe(EXIT_OK);
    expect(pretty.stdout).toContain("AI Pull Request Review");
    expect(pretty.stdout).toContain("Score:");
    expect(pretty.stdout).toMatch(/Recommendation/i);

    const json = await runCli(["--demo", "--format", "json"]);
    const parsed = JSON.parse(json.stdout) as { score: number; findings: unknown[] };
    expect(parsed.score).toBeGreaterThanOrEqual(0);
    expect(parsed.findings.length).toBeGreaterThan(0);
  });

  it("maps severity threshold to exit code 2", () => {
    expect(exceedsSeverityThreshold([{ severity: "high" }], "medium")).toBe(true);
    expect(exceedsSeverityThreshold([{ severity: "low" }], "medium")).toBe(false);
    expect(EXIT_THRESHOLD).toBe(2);
  });

  it("fails when secrets are missing for live URLs", async () => {
    const result = await runCli(["https://github.com/acme/frontend/pull/153"], {});
    expect(result.exitCode).toBe(EXIT_RUNTIME);
    expect(result.stderr).toContain("GITHUB_TOKEN");
  });
});
