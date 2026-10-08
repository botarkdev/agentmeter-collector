import type { SkipReason } from "../run/run-outcome.js";
/**
 * The content boundary of this package.
 *
 * This module is the ONLY one that ever holds a parsed transcript event. Everything downstream
 * sees `UsageTurn`, which has five fields and five counters and no representation for message
 * content, tool input or output, file contents, `cwd`, `gitBranch`, `slug`, `entrypoint`,
 * `error`, `uuid` or anything else a transcript carries. That is not a convention to be
 * remembered at review time — there is simply no field for those things to travel in
 * (spec.md FR-024, FR-025; research.md Decision 5).
 *
 * One of those fields is READ here, and still never carried: a turn's `cwd` is handed to the
 * scope a run was given, which answers whether the turn belongs to the repository being reported,
 * and is then dropped (specs/repository-scope/decision.md). Selecting a turn by a path is not
 * transmitting the path.
 *
 * Nothing here throws. A line that is not usage is ignored; a line that looks like usage but
 * cannot be turned into a measurement is skipped with a reason that is counted and reported
 * (spec.md FR-028).
 */
export interface TokenCounts {
    readonly input: number;
    readonly output: number;
    readonly cacheWrite5m: number;
    readonly cacheWrite1h: number;
    readonly cacheRead: number;
}
export interface UsageTurn {
    readonly messageId: string;
    readonly occurredAt: string;
    readonly sessionId?: string;
    readonly model: string;
    readonly tokens: TokenCounts;
}
export type ExtractionResult = 
/** Not an assistant turn carrying usage — the overwhelming majority of transcript lines. Not
 * reported, because reporting it would drown every genuine skip in noise. */
{
    readonly kind: "ignored";
}
/** A usage turn of another repository. Counted, so a scope that matches nothing is visible,
 * but not a skip: nothing is wrong with it. */
 | {
    readonly kind: "out-of-scope";
}
/** Looked like usage but cannot be submitted. Counted and reported. */
 | {
    readonly kind: "skipped";
    readonly reason: SkipReason;
} | {
    readonly kind: "turn";
    readonly turn: UsageTurn;
};
/** Answers whether a turn that ran in this working directory is to be reported. */
export type WorkingDirectoryFilter = (workingDirectory: string | undefined) => boolean;
export declare function totalTokens(tokens: TokenCounts): number;
/**
 * A parsed transcript line in; a `UsageTurn`, a counted skip, or nothing, out.
 *
 * The key is `message.id` alone (research.md Decision 1). Measured over 60 real transcripts:
 * 5 616 of 8 667 message ids appear on more than one line, 404 appear under more than one session
 * id after a resume, 14 turns carry no `requestId` at all, and no id was ever seen under two
 * different request ids. So the id alone deduplicates everything the composite would, keys the
 * turns the composite cannot, and — unlike anything containing the session id — survives a
 * resumed session without charging its earlier turns twice.
 *
 * `accepts`, when given, is asked before anything else is checked: a turn of another repository
 * is none of this run's business, and reporting its missing model as a skip would fill one
 * repository's outcome with another's anomalies.
 */
export declare function extractUsageTurn(value: unknown, accepts?: WorkingDirectoryFilter): ExtractionResult;
