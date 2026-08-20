import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
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

export type QueueRead =
  | { readonly kind: "batch"; readonly batch: IngestBatch }
  /** The file exists but is not a batch this collector can send. The caller removes it rather
   * than letting it block the drain forever. */
  | { readonly kind: "unreadable" };

export interface BatchQueue {
  enqueue(batches: readonly IngestBatch[], maxQueuedBatches: number): Promise<EnqueueResult>;
  /** Oldest first. */
  list(): Promise<readonly string[]>;
  read(name: string): Promise<QueueRead>;
  remove(name: string): Promise<void>;
}

const QUEUE_SUFFIX = ".json";
const TEMP_SUFFIX = ".tmp";

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
export function batchFileName(nowMs: number, sequence: number, random: string): string {
  const millis = String(nowMs).padStart(14, "0");
  const ordinal = String(sequence).padStart(6, "0");
  return `${millis}-${ordinal}-${random}${QUEUE_SUFFIX}`;
}

/** Per-process, shared across queue instances: two queues in one process still order correctly
 * relative to each other. */
let sequenceCounter = 0;

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, "0");
}

export class FileBatchQueue implements BatchQueue {
  constructor(
    private readonly directory: string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async enqueue(
    batches: readonly IngestBatch[],
    maxQueuedBatches: number,
  ): Promise<EnqueueResult> {
    if (batches.length === 0) {
      return { enqueued: 0, discarded: 0, failed: false };
    }

    try {
      await mkdir(this.directory, { recursive: true });
    } catch {
      return { enqueued: 0, discarded: 0, failed: true };
    }

    let enqueued = 0;
    let failed = false;
    for (const batch of batches) {
      const name = batchFileName(this.now(), sequenceCounter++, randomSuffix());
      const finalPath = join(this.directory, name);
      const tempPath = `${finalPath}${TEMP_SUFFIX}`;
      try {
        await writeFile(tempPath, JSON.stringify(batch), "utf8");
        await rename(tempPath, finalPath);
        enqueued += 1;
      } catch {
        failed = true;
        // Best effort: a temp file left behind by a failed write is never listed (it does not end
        // in .json), but removing it keeps the directory from accumulating debris.
        await unlink(tempPath).catch(() => undefined);
      }
    }

    const discarded = await this.enforceCeiling(maxQueuedBatches);
    return { enqueued, discarded, failed };
  }

  /**
   * Holds the ceiling by removing the OLDEST batches first (FR-022). Enforced after writing, so
   * the batches this run just produced — the newest, and the ones most likely to still be
   * deliverable — are the ones kept.
   */
  private async enforceCeiling(maxQueuedBatches: number): Promise<number> {
    const names = await this.list();
    const excess = names.length - Math.max(1, Math.floor(maxQueuedBatches));
    if (excess <= 0) {
      return 0;
    }
    let discarded = 0;
    for (const name of names.slice(0, excess)) {
      try {
        await unlink(join(this.directory, name));
        discarded += 1;
      } catch {
        // Another run may have delivered and removed it already. Nothing to do.
      }
    }
    return discarded;
  }

  async list(): Promise<readonly string[]> {
    let entries: string[];
    try {
      entries = await readdir(this.directory);
    } catch {
      return [];
    }
    // `.tmp` files are excluded by construction: only a completed rename produces a `.json` name.
    return entries.filter((name) => name.endsWith(QUEUE_SUFFIX)).sort();
  }

  async read(name: string): Promise<QueueRead> {
    let raw: string;
    try {
      raw = await readFile(join(this.directory, name), "utf8");
    } catch {
      return { kind: "unreadable" };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { kind: "unreadable" };
    }
    if (!isIngestBatch(parsed)) {
      return { kind: "unreadable" };
    }
    return { kind: "batch", batch: parsed };
  }

  async remove(name: string): Promise<void> {
    await unlink(join(this.directory, name)).catch(() => undefined);
  }
}

function isIngestBatch(value: unknown): value is IngestBatch {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.agent === "string" &&
    record.agent.length > 0 &&
    Array.isArray(record.measurements) &&
    record.measurements.length > 0
  );
}
