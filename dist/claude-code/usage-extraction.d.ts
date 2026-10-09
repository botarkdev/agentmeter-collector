import type { Attributor, TurnDimension } from "../attribution/attribution-rules.js";
import type { SkipReason } from "../run/run-outcome.js";
/**
 * The content boundary of this package.
 *
 * This module is the ONLY one that ever holds a parsed transcript event. Everything downstream
 * sees `UsageTurn`, which has five fields, five counters and a list of dimensions, and no
 * representation for message content, tool input or output, file contents, `cwd`, `gitBranch`,
 * `slug`, `entrypoint`, `error`, `uuid` or anything else a transcript carries. That is not a
 * convention to be remembered at review time — there is simply no field for those things to
 * travel in (spec.md FR-024, FR-025; research.md Decision 5).
 *
 * Two of those fields are READ here, and still never carried:
 *
 * - a turn's `cwd` is handed to the scope a run was given, which answers whether the turn belongs
 *   to the repository being reported, and is then dropped (specs/repository-scope/decision.md).
 *   Selecting a turn by a path is not transmitting the path.
 * - a turn's `gitBranch` is handed to the attribution function a run was given, which answers
 *   with the dimensions the repository's committed rules derive from it, and is then dropped
 *   (specs/attribution-rules/decision.md). What travels is what a rule captured; the name does
 *   not. It is the only thing of the event that function is ever shown.
 *
 * A session's name and its generated title are written as events of their own (`custom-title`,
 * `agent-name`, `ai-title`). They are not assistant turns, so they are ignored by the first check
 * below like every other line that is not usage, and nothing here reads them: a name the user
 * typed and one generated from the conversation are recorded identically, so neither is sent.
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
    /** What the repository's rules derived for this turn. Absent when they derived nothing, or
     * when the run has no rules. */
    readonly dimensions?: readonly TurnDimension[];
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
 *
 * `attribute`, when given, is asked last, about a turn that is going to be reported, and is
 * handed an object built here with the branch as its one property — never the event.
 */
export declare function extractUsageTurn(value: unknown, accepts?: WorkingDirectoryFilter, attribute?: Attributor): ExtractionResult;
