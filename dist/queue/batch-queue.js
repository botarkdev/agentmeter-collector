import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
export function batchFileName(nowMs, sequence, random) {
    const millis = String(nowMs).padStart(14, "0");
    const ordinal = String(sequence).padStart(6, "0");
    return `${millis}-${ordinal}-${random}${QUEUE_SUFFIX}`;
}
/** Per-process, shared across queue instances: two queues in one process still order correctly
 * relative to each other. */
let sequenceCounter = 0;
function randomSuffix() {
    return Math.random().toString(36).slice(2, 10).padEnd(8, "0");
}
export class FileBatchQueue {
    directory;
    now;
    constructor(directory, now = () => Date.now()) {
        this.directory = directory;
        this.now = now;
    }
    async enqueue(batches, maxQueuedBatches) {
        if (batches.length === 0) {
            return { enqueued: 0, discarded: 0, failed: false };
        }
        try {
            await mkdir(this.directory, { recursive: true });
        }
        catch {
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
            }
            catch {
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
    async enforceCeiling(maxQueuedBatches) {
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
            }
            catch {
                // Another run may have delivered and removed it already. Nothing to do.
            }
        }
        return discarded;
    }
    async list() {
        let entries;
        try {
            entries = await readdir(this.directory);
        }
        catch {
            return [];
        }
        // `.tmp` files are excluded by construction: only a completed rename produces a `.json` name.
        return entries.filter((name) => name.endsWith(QUEUE_SUFFIX)).sort();
    }
    async read(name) {
        let raw;
        try {
            raw = await readFile(join(this.directory, name), "utf8");
        }
        catch {
            return { kind: "unreadable" };
        }
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            return { kind: "unreadable" };
        }
        if (!isIngestBatch(parsed)) {
            return { kind: "unreadable" };
        }
        return { kind: "batch", batch: parsed };
    }
    async remove(name) {
        await unlink(join(this.directory, name)).catch(() => undefined);
    }
}
function isIngestBatch(value) {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const record = value;
    return (typeof record.agent === "string" &&
        record.agent.length > 0 &&
        Array.isArray(record.measurements) &&
        record.measurements.length > 0);
}
