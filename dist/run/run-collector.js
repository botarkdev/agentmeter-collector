import { stat } from "node:fs/promises";
import { listTranscriptFiles } from "../claude-code/transcript-locations.js";
import { readTranscriptLines } from "../claude-code/transcript-reader.js";
import { CLAUDE_CODE_AGENT, splitIntoBatches } from "../contract/ingest-contract.js";
import { readCursor, writeCursor } from "../cursor/scan-cursor.js";
import { cursorPath, queueDirectory } from "../queue/queue-paths.js";
import { FileBatchQueue } from "../queue/batch-queue.js";
import { findRepositoryRoot } from "../scope/repository-root.js";
import { repositoryCacheDirectory, repositoryScope } from "../scope/turn-scope.js";
import { HttpIngestTransport } from "../transport/ingest-transport.js";
import { collectMeasurements } from "./collect.js";
import { RunOutcomeAccumulator } from "./run-outcome.js";
export const defaultScopeDependencies = {
    repositoryRoot: () => findRepositoryRoot(process.cwd()),
};
/**
 * `cacheDir` is where THIS run keeps its queue and cursor — the configured directory for a run
 * that reports the whole machine, a directory of its own under it for a repository.
 */
export function defaultDependencies(config, cacheDir) {
    return {
        now: () => Date.now(),
        queue: new FileBatchQueue(queueDirectory(cacheDir)),
        transport: new HttpIngestTransport({
            endpoint: config.endpoint,
            token: config.token,
            requestTimeoutMs: config.requestTimeoutMs,
        }, 
        // The global `fetch` is adapted to this package's own structural type at exactly one point,
        // so nothing else in the package depends on a platform global.
        globalThis.fetch),
        listFiles: listTranscriptFiles,
        statFile: async (path) => {
            const stats = await stat(path);
            return { size: stats.size, mtimeMs: stats.mtimeMs };
        },
        readLines: readTranscriptLines,
        readCursorFile: readCursor,
        writeCursorFile: writeCursor,
    };
}
export async function runCollector(resolved, overrides = {}, scopeDeps = defaultScopeDependencies) {
    const outcome = new RunOutcomeAccumulator();
    for (const failure of resolved.failures) {
        outcome.fail(failure.stage, failure.reason, failure.detail);
    }
    if (resolved.status === "not-configured") {
        // A successful no-op. A SessionEnd hook fires in repositories that never opted in, and telling
        // that developer something went wrong would be both untrue and annoying.
        return outcome.build("not-configured", 0, false);
    }
    const config = resolved.config;
    const now = overrides.now ?? (() => Date.now());
    const startedAt = now();
    let scope;
    let cacheDir = config.cacheDir;
    let deps;
    try {
        if (config.scope === "repository") {
            const root = await scopeDeps.repositoryRoot();
            scope = repositoryScope(root, config.transcriptsDir);
            cacheDir = repositoryCacheDirectory(config.cacheDir, root);
        }
        deps = { ...defaultDependencies(config, cacheDir), ...overrides };
    }
    catch {
        // The repository could not be named, so nothing can be said to belong to it. Reporting the
        // whole machine instead would be the one outcome the scope exists to prevent.
        outcome.fail("scan", "unreadable-file");
        return outcome.build("collected", now() - startedAt, false);
    }
    const expired = () => deps.now() - startedAt >= config.runBudgetMs;
    try {
        await collectAndEnqueue(config, cacheDir, scope, outcome, deps, expired);
        await drain(config, outcome, deps, expired);
    }
    catch {
        // Structurally unreachable — every stage above is total. Kept because FR-015 is a promise
        // about behaviour under conditions nobody enumerated, and a promise that depends on having
        // enumerated them is not one.
        outcome.fail("scan", "unreadable-file");
    }
    outcome.remaining = await countRemaining(deps.queue);
    return outcome.build("collected", deps.now() - startedAt, expired());
}
async function collectAndEnqueue(config, cacheDir, scope, outcome, deps, expired) {
    const discovery = await deps.listFiles(config.transcriptsDir);
    for (let index = 0; index < discovery.unreadableDirectories; index += 1) {
        outcome.fail("scan", "unreadable-file");
    }
    const cursor = await deps.readCursorFile(cursorPath(cacheDir));
    const { entries, nextCursor } = await collectMeasurements(discovery.files, cursor, config.pricingTier, outcome, { statFile: deps.statFile, readLines: deps.readLines, expired }, scope);
    if (entries.length > 0) {
        const batches = splitIntoBatches(CLAUDE_CODE_AGENT, entries, config.maxBatchSize);
        const result = await deps.queue.enqueue(batches, config.maxQueuedBatches);
        outcome.enqueued += result.enqueued;
        outcome.discarded += result.discarded;
        if (result.failed) {
            outcome.fail("queue", "unwritable-queue");
        }
        if (result.enqueued < batches.length) {
            // Nothing was fully retained, so the cursor must not advance past work that was never
            // written down. The next run re-reads and re-enqueues; the service deduplicates.
            return;
        }
    }
    // Ordering matters and is the whole point (research.md Decision 8): the batch is on disk BEFORE
    // the cursor says the lines were read. A crash between the two costs a redundant send that the
    // ledger absorbs, never a lost measurement.
    const written = await deps.writeCursorFile(cursorPath(cacheDir), nextCursor, new Set(discovery.files));
    if (!written) {
        outcome.fail("cursor", "unwritable-cursor");
    }
}
async function drain(config, outcome, deps, expired) {
    const names = await deps.queue.list();
    for (const name of names) {
        if (expired()) {
            return;
        }
        const item = await deps.queue.read(name);
        if (item.kind === "unreadable") {
            // Removed rather than left to block the drain forever. It is one batch, and every later
            // batch is behind it.
            await deps.queue.remove(name);
            outcome.discarded += 1;
            outcome.fail("queue", "queue-item-unreadable");
            continue;
        }
        const result = await deps.transport.deliver(item.batch);
        outcome.batchesSent += 1;
        if (result.kind === "accepted") {
            outcome.accepted += result.accepted;
            outcome.deduplicated += result.deduplicated;
            outcome.rejected += result.rejected;
            await deps.queue.remove(name);
            continue;
        }
        if (result.kind === "discard") {
            await deps.queue.remove(name);
            outcome.discarded += 1;
            outcome.fail("transport", result.reason, result.detail);
            continue;
        }
        outcome.fail("transport", result.reason, result.detail);
        if (result.stopDraining) {
            return;
        }
    }
}
async function countRemaining(queue) {
    try {
        return (await queue.list()).length;
    }
    catch {
        return 0;
    }
}
