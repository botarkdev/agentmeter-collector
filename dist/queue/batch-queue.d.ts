import type { IngestBatch } from "../contract/ingest-contract.js";
/**
 * Undelivered batches, on disk, so an unreachable service loses nothing (spec.md US2).
 *
 * One file per batch, written to a `.tmp` name and renamed into place. Two `SessionEnd` hooks can
 * fire at the same moment; appending to a shared file would interleave and corrupt, and defending
 * that needs a lock, which is one more thing that can hang a session close. `rename` within a
 * directory is atomic, so a partially written batch never has a name the drain can see (FR-017),
 * and two runs never choose the same name (FR-016). No lock is taken anywhere in this file.
 *
 * A queue file holds exactly the request body — `{ agent, measurements }`. Not the token, and not
 * the endpoint: a batch written under one configuration is delivered under whatever configuration
 * the next run resolves, which is what makes rotating a token or moving an endpoint recover the
 * backlog rather than strand it. It is also why a credential can never be found on disk here
 * (FR-027).
 *
 * `BatchQueue` is an interface so a run can be tested against a stand-in that fails on demand.
 * It is deliberately NOT given a throwing dummy implementation: the Constitution's
 * repository-and-strategy rule governs the API's data-access layer, and a dummy here would be
 * dead code with no caller (Principle V).
 */
export interface EnqueueResult {
    readonly enqueued: number;
    readonly discarded: number;
    /** True when something could not be written. The caller records the failure; this module does
     * not decide how a failure is reported. */
    readonly failed: boolean;
}
export type QueueRead = {
    readonly kind: "batch";
    readonly batch: IngestBatch;
}
/** The file exists but is not a batch this collector can send. The caller removes it rather
 * than letting it block the drain forever. */
 | {
    readonly kind: "unreadable";
};
export interface BatchQueue {
    enqueue(batches: readonly IngestBatch[], maxQueuedBatches: number): Promise<EnqueueResult>;
    /** Oldest first. */
    list(): Promise<readonly string[]>;
    read(name: string): Promise<QueueRead>;
    remove(name: string): Promise<void>;
}
/**
 * `<epoch-millis, zero-padded>-<sequence, zero-padded>-<random>.json`, so that sorting by name is
 * sorting by age. All three parts earn their place:
 *
 * - **millis**, zero-padded, so lexicographic order matches chronological order across runs.
 * - **sequence**, because a run enqueues its batches far faster than the clock ticks. Without it,
 *   every batch of a run shares one millisecond and their order is decided by the random suffix —
 *   which is to say, not decided at all. That defect made "oldest first" untrue for exactly the
 *   batches a single run produces, and it surfaced as an intermittently failing ordering test
 *   rather than as anything a reader would notice.
 * - **random**, because two runs can start in the same millisecond and each numbers its own
 *   sequence from zero; this is what keeps them from choosing the same name (FR-016).
 */
export declare function batchFileName(nowMs: number, sequence: number, random: string): string;
export declare class FileBatchQueue implements BatchQueue {
    private readonly directory;
    private readonly now;
    constructor(directory: string, now?: () => number);
    enqueue(batches: readonly IngestBatch[], maxQueuedBatches: number): Promise<EnqueueResult>;
    /**
     * Holds the ceiling by removing the OLDEST batches first (FR-022). Enforced after writing, so
     * the batches this run just produced — the newest, and the ones most likely to still be
     * deliverable — are the ones kept.
     */
    private enforceCeiling;
    list(): Promise<readonly string[]>;
    read(name: string): Promise<QueueRead>;
    remove(name: string): Promise<void>;
}
