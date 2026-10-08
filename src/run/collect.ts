import { extractUsageTurn } from "../claude-code/usage-extraction.js";
import type { MeasurementEntry } from "../contract/ingest-contract.js";
import { measurementTotal, projectMeasurement } from "../contract/measurement-projection.js";
import type { CursorEntry, ScanCursor } from "../cursor/scan-cursor.js";
import { resumeOffset } from "../cursor/scan-cursor.js";
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
  readonly readLines: (
    path: string,
    fromOffset: number,
    onLine: (parsed: unknown) => void,
  ) => Promise<TranscriptReadResult>;
  /** True once the run has spent its budget. Checked between files, never inside one — abandoning
   * a file half-read would record an offset for lines that were never collected. */
  readonly expired: () => boolean;
}

export interface CollectResult {
  readonly entries: readonly MeasurementEntry[];
  readonly nextCursor: ScanCursor;
}

export async function collectMeasurements(
  files: readonly string[],
  cursor: ScanCursor,
  pricingTier: string,
  outcome: RunOutcomeAccumulator,
  deps: CollectDependencies,
  /** Absent: every turn on the machine is reported. */
  scope?: TurnScope,
): Promise<CollectResult> {
  const byKey = new Map<string, MeasurementEntry>();
  const nextFiles: Record<string, CursorEntry> = { ...cursor.files };

  outcome.filesConsidered += files.length;

  for (const path of files) {
    if (deps.expired()) {
      break;
    }

    let stats: FileStats;
    try {
      stats = await deps.statFile(path);
    } catch {
      outcome.fail("scan", "unreadable-file");
      continue;
    }

    const from = resumeOffset(cursor.files[path], stats.size, stats.mtimeMs);
    if (from === "skip") {
      continue;
    }

    // A transcript the scope claims whole is not asked about turn by turn. Every other one is
    // still READ — only a turn's own working directory says whether it belongs — and its offset
    // is recorded like any other's, so it is not read again.
    const accepts =
      scope === undefined || scope.acceptsTranscript(path)
        ? undefined
        : scope.acceptsWorkingDirectory;

    let read: TranscriptReadResult;
    try {
      read = await deps.readLines(path, from, (parsed) => {
        const result = extractUsageTurn(parsed, accepts);
        if (result.kind === "ignored") {
          return;
        }
        if (result.kind === "out-of-scope") {
          outcome.turnsOutOfScope += 1;
          return;
        }
        if (result.kind === "skipped") {
          outcome.skip(result.reason);
          return;
        }
        outcome.turnsFound += 1;
        const entry = projectMeasurement(result.turn, pricingTier);
        const existing = byKey.get(entry.idempotencyKey);
        if (existing === undefined) {
          byKey.set(entry.idempotencyKey, entry);
          return;
        }
        // Duplicates are the norm, not an edge case: 5 616 of 8 667 message ids in the sampled
        // transcripts appear on more than one line, and 7 of them carry DIFFERENT usage across
        // those lines — a partial record written first, the complete one written after. Keeping
        // the greatest total is what stops the partial record winning; keeping it by TOTAL rather
        // than by "last seen" is what makes the result independent of the order files happened to
        // be read in (research.md Decision 2).
        outcome.duplicatesCollapsed += 1;
        if (measurementTotal(entry) > measurementTotal(existing)) {
          byKey.set(entry.idempotencyKey, entry);
        }
      });
    } catch {
      outcome.fail("scan", "unreadable-file");
      continue;
    }

    outcome.filesRead += 1;
    outcome.linesRead += read.linesRead;
    outcome.skip("unparsable-line", read.unparsable);
    nextFiles[path] = {
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      offset: read.offsetReached,
    };
  }

  const entries = [...byKey.values()];
  outcome.measurements += entries.length;
  return { entries, nextCursor: { version: 1, files: nextFiles } };
}
