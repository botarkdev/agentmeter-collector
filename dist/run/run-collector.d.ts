import type { LoadedRules, RuleMatcher } from "../attribution/attribution-rules.js";
import { listTranscriptFiles } from "../claude-code/transcript-locations.js";
import { readTranscriptLines } from "../claude-code/transcript-reader.js";
import type { CollectorConfig, ResolvedConfig } from "../config/collector-config.js";
import { readCursor, writeCursor } from "../cursor/scan-cursor.js";
import type { BatchQueue } from "../queue/batch-queue.js";
import type { IngestTransport } from "../transport/ingest-transport.js";
import type { RunOutcome } from "./run-outcome.js";
/**
 * The entry point. Scans, projects, retains and delivers — and **never rejects, for any input,
 * any filesystem state, or any behaviour of the service** (spec.md FR-015).
 *
 * That guarantee is structural rather than careful: every stage below is already total (nothing
 * in this package throws by design), and the whole body sits inside one `try` whose `catch`
 * records a failure and returns the outcome accumulated so far. A run that goes wrong in a way
 * nobody anticipated still returns an outcome, because the alternative is an exception reaching a
 * `SessionEnd` hook and a developer seeing their session close report an error from a tool that
 * exists to be invisible.
 */
export interface RunDependencies {
    readonly now: () => number;
    readonly queue: BatchQueue;
    readonly transport: IngestTransport;
    readonly listFiles: typeof listTranscriptFiles;
    readonly statFile: (path: string) => Promise<{
        size: number;
        mtimeMs: number;
    }>;
    readonly readLines: typeof readTranscriptLines;
    readonly readCursorFile: typeof readCursor;
    readonly writeCursorFile: typeof writeCursor;
    /** The attribution rules of the repository at this root. Asked once, and only by a run that
     * reports one repository. Must not reject; a run survives it if it does. */
    readonly loadRules: (repositoryRoot: string) => Promise<LoadedRules>;
    /** One bounded match of a committed pattern. */
    readonly matchRule: RuleMatcher;
}
/**
 * What a run needs to know before it can build the rest: which repository it belongs to. Asked
 * only when the configured scope is `repository`. Separate from `RunDependencies` because the
 * queue's location depends on the answer.
 */
export interface ScopeDependencies {
    /** The root of the repository the run was started in. Must not reject. */
    readonly repositoryRoot: () => Promise<string>;
}
export declare const defaultScopeDependencies: ScopeDependencies;
/**
 * `cacheDir` is where THIS run keeps its queue and cursor — the configured directory for a run
 * that reports the whole machine, a directory of its own under it for a repository.
 */
export declare function defaultDependencies(config: CollectorConfig, cacheDir: string): RunDependencies;
export declare function runCollector(resolved: ResolvedConfig, overrides?: Partial<RunDependencies>, scopeDeps?: ScopeDependencies): Promise<RunOutcome>;
