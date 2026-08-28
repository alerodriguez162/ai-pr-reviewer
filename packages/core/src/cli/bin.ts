#!/usr/bin/env node
import { executeCli } from "./run.js";

const code = await executeCli();
process.exit(code);
