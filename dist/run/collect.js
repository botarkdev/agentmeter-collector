import { extractUsageTurn } from "../claude-code/usage-extraction.js";
import { measurementTotal, projectMeasurement } from "../contract/measurement-projection.js";
import { resumeOffset } from "../cursor/scan-cursor.js";
export async function collectMeasurements(files, cursor, pricingTier, outcome, deps, 
/** Absent: every turn on the machine is reported. */
scope, 
/** Absent: the run has no attribution rules, and no measurement carries a dimension. */
attribute) {
    const byKey = new Map();
    const nextFiles = { ...cursor.files };
    outcome.filesConsidered += files.length;
    for (const path of files) {
        if (deps.expired()) {
            break;
        }
        let stats;
        try {
            stats = await deps.statFile(path);
        }
        catch {
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
        const accepts = scope === undefined || scope.acceptsTranscript(path)
            ? undefined
            : scope.acceptsWorkingDirectory;
        let read;
        try {
            read = await deps.readLines(path, from, (parsed) => {
                const result = extractUsageTurn(parsed, accepts, attribute);
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
        }
        catch {
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
    outcome.turnsAttributed += entries.filter((entry) => entry.dimensions !== undefined).length;
    return { entries, nextCursor: { version: 1, files: nextFiles } };
}
