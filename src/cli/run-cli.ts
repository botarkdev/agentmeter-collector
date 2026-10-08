import { resolveConfigFromEnv } from "../config/collector-config.js";
import type { RunOutcome } from "../run/run-outcome.js";
import { runCollector } from "../run/run-collector.js";

/**
 * `agentmeter push`, as a function.
 *
 * Everything except `process.argv`, `process.env` and `process.exit` is a parameter, so the two
 * properties that matter — it always returns 0, and it never prints a credential — are ordinary
 * unit assertions rather than something that needs a spawned process to observe.
 *
 * **The exit code is always 0.** The only reader of a `SessionEnd` hook's exit code is the agent
 * session this package must never disturb (Constitution, Principle IV), so it is not a place to
 * report anything. What happened is on stdout, as counts.
 */

export interface CliIo {
  readonly stdout: (line: string) => void;
  readonly env: { readonly [key: string]: string | undefined };
}

export const USAGE = "usage: agentmeter push";

export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const command = argv[0] ?? "push";
  if (command !== "push") {
    io.stdout(USAGE);
    return 0;
  }

  const outcome = await runCollector(resolveConfigFromEnv(io.env));
  io.stdout(summarise(outcome));
  return 0;
}

/**
 * One line, built only from counts and closed-vocabulary codes. Nothing here interpolates a path,
 * a URL, a token, or anything read out of a transcript — a summary printed into a developer's
 * terminal is as public as anything this package produces (spec.md FR-025, FR-027).
 */
export function summarise(outcome: RunOutcome): string {
  if (outcome.status === "not-configured") {
    return "agentmeter: not configured (set AGENTMETER_ENDPOINT and AGENTMETER_TOKEN) — nothing collected";
  }

  const parts = [
    `found ${outcome.scan.measurements}`,
    `accepted ${outcome.delivery.accepted}`,
    `deduplicated ${outcome.delivery.deduplicated}`,
    `rejected ${outcome.delivery.rejected}`,
    `queued ${outcome.queue.remaining}`,
  ];
  if (outcome.scan.turnsOutOfScope > 0) {
    parts.push(`out-of-scope ${outcome.scan.turnsOutOfScope}`);
  }
  if (outcome.queue.discarded > 0) {
    parts.push(`discarded ${outcome.queue.discarded}`);
  }
  if (outcome.budgetExhausted) {
    parts.push("budget-exhausted");
  }
  for (const skip of outcome.skipped) {
    parts.push(`skipped:${skip.reason} ${skip.count}`);
  }
  for (const failure of outcome.failures) {
    parts.push(`${failure.stage}:${failure.reason} ${failure.count}`);
  }
  return `agentmeter: ${parts.join(" · ")}`;
}
