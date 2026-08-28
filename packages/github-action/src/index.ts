import * as core from "@actions/core";
import { createLogger } from "@larva-factory/ai-pr-reviewer";
import { detectPullRequestContext } from "./context.js";
import { parseActionInputs } from "./inputs.js";
import { formatActionFailure, runAction } from "./run.js";

export async function main(): Promise<void> {
  const logger = createLogger("[AI PR Reviewer]");
  try {
    const inputs = parseActionInputs(core);
    const context = detectPullRequestContext(process.env);
    await runAction(inputs, context, {
      logger,
      setOutput: (name, value) => core.setOutput(name, value),
      setFailed: (message) => core.setFailed(message),
    });
  } catch (error) {
    core.setFailed(formatActionFailure(error));
  }
}

const isEntrypoint = process.argv[1]?.includes("index");
if (isEntrypoint) {
  void main();
}
