/**
 * What a collector run reports (specs/0019-claude-code-collector/contracts/run-outcome.md).
 *
 * FR-015 forbids this package every ordinary way of saying something went wrong — it may not
 * throw, may not exit non-zero, and may not write to a stream an agent session treats as a
 * failure. So this type is not a convenience: it is the ONLY channel by which anything about a
 * run is observable, and a failure mode with no field here is one nobody can see.
 *
 * Everything in it is a count, a closed-vocabulary code, or a duration. Nothing read out of a
 * transcript, and no credential, has a representation here — which is what stops a diagnostic
 * from becoming the content leak FR-025 exists to prevent.
 */
/**
 * Accumulates a run's outcome as it happens. Mutable on purpose: a run reports what it managed to
 * do before it ran out of time or hit something it could not do, so the outcome has to be
 * buildable incrementally from every stage rather than assembled at the end from data a failed
 * stage never produced.
 */
export class RunOutcomeAccumulator {
    filesConsidered = 0;
    filesRead = 0;
    linesRead = 0;
    turnsFound = 0;
    turnsOutOfScope = 0;
    turnsAttributed = 0;
    measurements = 0;
    duplicatesCollapsed = 0;
    batchesSent = 0;
    accepted = 0;
    deduplicated = 0;
    rejected = 0;
    enqueued = 0;
    remaining = 0;
    discarded = 0;
    skips = new Map();
    failures = new Map();
    skip(reason, count = 1) {
        if (count <= 0) {
            return;
        }
        this.skips.set(reason, (this.skips.get(reason) ?? 0) + count);
    }
    fail(stage, reason, detail) {
        const key = `${stage}|${reason}|${detail ?? ""}`;
        const existing = this.failures.get(key);
        if (existing) {
            existing.count += 1;
            return;
        }
        // `detail` is ABSENT when there is none, never null or "" — Constitution, Observability &
        // Logging: "Fields outside a record's scope MUST be ABSENT".
        const record = detail === undefined ? { stage, reason, count: 1 } : { stage, reason, count: 1, detail };
        this.failures.set(key, { record, count: 1 });
    }
    build(status, durationMs, budgetExhausted) {
        return {
            status,
            scan: {
                filesConsidered: this.filesConsidered,
                filesRead: this.filesRead,
                linesRead: this.linesRead,
                turnsFound: this.turnsFound,
                turnsOutOfScope: this.turnsOutOfScope,
                turnsAttributed: this.turnsAttributed,
                measurements: this.measurements,
                duplicatesCollapsed: this.duplicatesCollapsed,
            },
            delivery: {
                batchesSent: this.batchesSent,
                accepted: this.accepted,
                deduplicated: this.deduplicated,
                rejected: this.rejected,
            },
            queue: {
                enqueued: this.enqueued,
                remaining: this.remaining,
                discarded: this.discarded,
            },
            skipped: [...this.skips.entries()].map(([reason, count]) => ({ reason, count })),
            failures: [...this.failures.values()].map(({ record, count }) => record.detail === undefined
                ? { stage: record.stage, reason: record.reason, count }
                : { stage: record.stage, reason: record.reason, count, detail: record.detail }),
            durationMs,
            budgetExhausted,
        };
    }
}
