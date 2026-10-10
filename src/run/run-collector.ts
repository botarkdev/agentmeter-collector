import { stat } from "node:fs/promises";
import type {
  Attributor,
  KeyDigest,
  LoadedRules,
  RuleMatcher,
} from "../attribution/attribution-rules.js";
import {
  buildAttributor,
  guardedMatch,
  loadAttributionRules,
  saltedDigest,
} from "../attribution/attribution-rules.js";
import { listTranscriptFiles } from "../claude-code/transcript-locations.js";
import { readTranscriptLines } from "../claude-code/transcript-reader.js";
import type { CollectorConfig, ResolvedConfig } from "../config/collector-config.js";
import { CLAUDE_CODE_AGENT, splitIntoBatches } from "../contract/ingest-contract.js";
import { readCursor, writeCursor } from "../cursor/scan-cursor.js";
import { cursorPath, queueDirectory } from "../queue/queue-paths.js";
import type { BatchQueue } from "../queue/batch-queue.js";
import { FileBatchQueue } from "../queue/batch-queue.js";
import { findRepositoryRoot } from "../scope/repository-root.js";
import type { TurnScope } from "../scope/turn-scope.js";
import { repositoryCacheDirectory, repositoryScope } from "../scope/turn-scope.js";
import type { FetchLike, IngestTransport } from "../transport/ingest-transport.js";
import { HttpIngestTransport } from "../transport/ingest-transport.js";
import { collectMeasurements } from "./collect.js";
import type { RunOutcome } from "./run-outcome.js";
import { RunOutcomeAccumulator } from "./run-outcome.js";

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
  readonly statFile: (path: string) => Promise<{ size: number; mtimeMs: number }>;
  readonly readLines: typeof readTranscriptLines;
  readonly readCursorFile: typeof readCursor;
  readonly writeCursorFile: typeof writeCursor;
  /** The attribution rules of the repository at this root. Asked once, and only by a run that
   * reports one repository. Must not reject; a run survives it if it does. */
  readonly loadRules: (repositoryRoot: string) => Promise<LoadedRules>;
  /** One bounded match of a committed pattern. */
  readonly matchRule: RuleMatcher;
  /** The digest of a key a rule file says is sent hashed. Absent: the collector's own. */
  readonly digestKey?: KeyDigest;
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

export const defaultScopeDependencies: ScopeDependencies = {
  repositoryRoot: () => findRepositoryRoot(process.cwd()),
};

/**
 * `cacheDir` is where THIS run keeps its queue and cursor — the configured directory for a run
 * that reports the whole machine, a directory of its own under it for a repository.
 */
export function defaultDependencies(config: CollectorConfig, cacheDir: string): RunDependencies {
  return {
    now: () => Date.now(),
    queue: new FileBatchQueue(queueDirectory(cacheDir)),
    transport: new HttpIngestTransport(
      {
        endpoint: config.endpoint,
        token: config.token,
        requestTimeoutMs: config.requestTimeoutMs,
      },
      // The global `fetch` is adapted to this package's own structural type at exactly one point,
      // so nothing else in the package depends on a platform global.
      globalThis.fetch as unknown as FetchLike,
    ),
    listFiles: listTranscriptFiles,
    statFile: async (path) => {
      const stats = await stat(path);
      return { size: stats.size, mtimeMs: stats.mtimeMs };
    },
    readLines: readTranscriptLines,
    readCursorFile: readCursor,
    writeCursorFile: writeCursor,
    loadRules: (repositoryRoot) => loadAttributionRules(repositoryRoot),
    matchRule: guardedMatch,
  };
}

/** What a run was given to attribute with, and how to ask whether it had to give up. */
interface RunAttribution {
  readonly attribute: Attributor;
  readonly timedOut: () => boolean;
}

/**
 * The repository's attribution rules, ready to use, or nothing.
 *
 * Whatever goes wrong here costs the run its dimensions and nothing else: the measurements are
 * still collected and submitted, and the outcome says what happened. Token counts cannot be
 * recovered once a transcript has rotated off disk; a label can be applied again.
 */
async function prepareAttribution(
  repositoryRoot: string,
  config: CollectorConfig,
  outcome: RunOutcomeAccumulator,
  deps: RunDependencies,
): Promise<RunAttribution | undefined> {
  let loaded: LoadedRules;
  try {
    loaded = await deps.loadRules(repositoryRoot);
  } catch {
    loaded = { kind: "failed", reason: "unreadable-rules" };
  }
  if (loaded.kind === "none") {
    return undefined;
  }
  if (loaded.kind === "failed") {
    outcome.fail("attribution", loaded.reason, loaded.detail);
    return undefined;
  }
  const options = { matcher: deps.matchRule, digest: deps.digestKey ?? saltedDigest };
  return buildAttributor(
    loaded.rules,
    config.sourceName === undefined ? options : { ...options, source: config.sourceName },
  );
}

export async function runCollector(
  resolved: ResolvedConfig,
  overrides: Partial<RunDependencies> = {},
  scopeDeps: ScopeDependencies = defaultScopeDependencies,
): Promise<RunOutcome> {
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

  let scope: TurnScope | undefined;
  let repositoryRoot: string | undefined;
  let cacheDir = config.cacheDir;
  let deps: RunDependencies;
  try {
    if (config.scope === "repository") {
      const root = await scopeDeps.repositoryRoot();
      repositoryRoot = root;
      scope = repositoryScope(root, config.transcriptsDir);
      cacheDir = repositoryCacheDirectory(config.cacheDir, root);
    }
    deps = { ...defaultDependencies(config, cacheDir), ...overrides };
  } catch {
    // The repository could not be named, so nothing can be said to belong to it. Reporting the
    // whole machine instead would be the one outcome the scope exists to prevent.
    outcome.fail("scan", "unreadable-file");
    return outcome.build("collected", now() - startedAt, false);
  }
  const expired = (): boolean => deps.now() - startedAt >= config.runBudgetMs;

  try {
    // A run that reports the whole machine reads no rule file and attributes nothing: one
    // repository's rules must not label another repository's turns.
    const attribution =
      repositoryRoot === undefined
        ? undefined
        : await prepareAttribution(repositoryRoot, config, outcome, deps);
    await collectAndEnqueue(
      config,
      cacheDir,
      scope,
      attribution?.attribute,
      outcome,
      deps,
      expired,
    );
    if (attribution?.timedOut() === true) {
      // Once, however many turns it cost: the rules were switched off at the first one.
      outcome.fail("attribution", "rule-timeout");
    }
    await drain(config, outcome, deps, expired);
  } catch {
    // Structurally unreachable — every stage above is total. Kept because FR-015 is a promise
    // about behaviour under conditions nobody enumerated, and a promise that depends on having
    // enumerated them is not one.
    outcome.fail("scan", "unreadable-file");
  }

  outcome.remaining = await countRemaining(deps.queue);
  return outcome.build("collected", deps.now() - startedAt, expired());
}

async function collectAndEnqueue(
  config: CollectorConfig,
  cacheDir: string,
  scope: TurnScope | undefined,
  attribute: Attributor | undefined,
  outcome: RunOutcomeAccumulator,
  deps: RunDependencies,
  expired: () => boolean,
): Promise<void> {
  const discovery = await deps.listFiles(config.transcriptsDir);
  for (let index = 0; index < discovery.unreadableDirectories; index += 1) {
    outcome.fail("scan", "unreadable-file");
  }

  const cursor = await deps.readCursorFile(cursorPath(cacheDir));
  const { entries, nextCursor } = await collectMeasurements(
    discovery.files,
    cursor,
    config.pricingTier,
    outcome,
    { statFile: deps.statFile, readLines: deps.readLines, expired },
    scope,
    attribute,
  );

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
  const written = await deps.writeCursorFile(
    cursorPath(cacheDir),
    nextCursor,
    new Set(discovery.files),
  );
  if (!written) {
    outcome.fail("cursor", "unwritable-cursor");
  }
}

async function drain(
  config: CollectorConfig,
  outcome: RunOutcomeAccumulator,
  deps: RunDependencies,
  expired: () => boolean,
): Promise<void> {
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

async function countRemaining(queue: BatchQueue): Promise<number> {
  try {
    return (await queue.list()).length;
  } catch {
    return 0;
  }
}
