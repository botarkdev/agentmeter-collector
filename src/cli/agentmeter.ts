#!/usr/bin/env node
import { runCli } from "./run-cli.js";

// Bootstrap only — no logic, and not tested (Constitution, Principle VII: bootstrap files MUST
// NOT be tested). Everything it does is in run-cli.ts, which is.
process.exitCode = await runCli(process.argv.slice(2), {
  stdout: (line) => process.stdout.write(`${line}\n`),
  env: process.env,
});
