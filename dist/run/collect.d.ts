import type { MeasurementEntry } from "../contract/ingest-contract.js";
import type { ScanCursor } from "../cursor/scan-cursor.js";
import type { TurnScope } from "../scope/turn-scope.js";
import type { RunOutcomeAccumulator } from "./run-outcome.js";
/**
 * Scan → extract → project → deduplicate. The reading half of a run.
 *
 * Its dependencies are parameters rather than imports so the whole thing is testable without a
 * filesystem, and so the deadline can be driven by an injected clock instead of a wall clock — a
 * test that asserts on elapsed real time asserts on the machine it runs on.
 */
export interface FileStats {
    readonly size: number;
    readonly mtimeMs: number;
}
export interface TranscriptReadResult {
    readonly offsetReached: number;
    readonly linesRead: number;
    readonly unparsable: number;
}
export interface CollectDependencies {
    readonly statFile: (path: string) => Promise<FileStats>;
    readonly readLines: (path: string, fromOffset: number, onLine: (parsed: unknown) => void) => Promise<TranscriptReadResult>;
    /** True once the run has spent its budget. Checked between files, never inside one — abandoning
     * a file half-read would record an offset for lines that were never collected. */
    readonly expired: () => boolean;
}
export interface CollectResult {
    readonly entries: readonly MeasurementEntry[];
    readonly nextCursor: ScanCursor;
}
export declare function collectMeasurements(files: readonly string[], cursor: ScanCursor, pricingTier: string, outcome: RunOutcomeAccumulator, deps: CollectDependencies, 
/** Absent: every turn on the machine is reported. */
scope?: TurnScope): Promise<CollectResult>;
