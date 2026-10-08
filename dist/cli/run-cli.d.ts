import type { RunOutcome } from "../run/run-outcome.js";
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
    readonly env: {
        readonly [key: string]: string | undefined;
    };
}
export declare const USAGE = "usage: agentmeter push";
export declare function runCli(argv: readonly string[], io: CliIo): Promise<number>;
/**
 * One line, built only from counts and closed-vocabulary codes. Nothing here interpolates a path,
 * a URL, a token, or anything read out of a transcript — a summary printed into a developer's
 * terminal is as public as anything this package produces (spec.md FR-025, FR-027).
 */
export declare function summarise(outcome: RunOutcome): string;
