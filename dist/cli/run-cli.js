import { resolveConfigFromEnv } from "../config/collector-config.js";
import { runCollector } from "../run/run-collector.js";
export const USAGE = "usage: agentmeter push";
export async function runCli(argv, io) {
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
export function summarise(outcome) {
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
