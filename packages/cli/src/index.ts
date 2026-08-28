#!/usr/bin/env node
import { executeCli } from "@larva-factory/ai-pr-reviewer";

const code = await executeCli();
process.exit(code);
