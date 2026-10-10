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

/** Why a turn that looked like usage was not submitted. Closed set; each is counted, never
 * silently dropped (spec.md US4 acceptance 4). */
export type SkipReason =
  | "unparsable-line"
  | "missing-key"
  | "missing-timestamp"
  | "missing-model"
  | "invalid-token-counts"
  | "zero-token-turn";

/** `attribution` is the repository's rule file: reading it, validating it, matching with it. */
export type FailureStage = "config" | "attribution" | "scan" | "queue" | "cursor" | "transport";

/** Why something did not work. Closed set, for the same reason `SkipReason` is. */
export type FailureReason =
  | "invalid-setting"
  | "invalid-rules"
  | "unreadable-rules"
  | "rule-timeout"
  | "unreadable-file"
  | "unwritable-queue"
  | "queue-item-unreadable"
  | "unwritable-cursor"
  | "unreachable"
  | "timeout"
  | "server-error"
  | "unrecognised-response"
  | "rejected-permanently"
  | "reauthentication-required"
  | "rate-limited";

export interface SkipRecord {
  readonly reason: SkipReason;
  readonly count: number;
}

/**
 * `detail` carries a code the SERVICE supplied (an error `code` from the documented error
 * contract, or a stated wait in seconds), the name of a setting, or the code of the check a rule
 * file failed — never a path, a URL, a token, a branch, a pattern, a dimension, a salt, or
 * anything read from a transcript. Identical records merge and carry a count, so a directory
 * of a thousand unreadable files produces one record rather than a thousand.
 */
export interface FailureRecord {
  readonly stage: FailureStage;
  readonly reason: FailureReason;
  readonly count: number;
  readonly detail?: string;
}

export interface ScanSummary {
  readonly filesConsidered: number;
  readonly filesRead: number;
  readonly linesRead: number;
  readonly turnsFound: number;
  /** Usage turns of other repositories, left out by the run's scope. Always 0 for a run that
   * reports the whole machine. */
  readonly turnsOutOfScope: number;
  /** Measurements that carry at least one dimension. Always 0 for a repository that declares no
   * attribution rules. A count: what the dimensions say is not reported here. */
  readonly turnsAttributed: number;
  readonly measurements: number;
  readonly duplicatesCollapsed: number;
}

export interface DeliverySummary {
  readonly batchesSent: number;
  readonly accepted: number;
  readonly deduplicated: number;
  readonly rejected: number;
}

export interface QueueSummary {
  readonly enqueued: number;
  readonly remaining: number;
  readonly discarded: number;
}

export interface RunOutcome {
  readonly status: "collected" | "not-configured";
  readonly scan: ScanSummary;
  readonly delivery: DeliverySummary;
  readonly queue: QueueSummary;
  readonly skipped: readonly SkipRecord[];
  readonly failures: readonly FailureRecord[];
  readonly durationMs: number;
  readonly budgetExhausted: boolean;
}

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

  private readonly skips = new Map<SkipReason, number>();
  private readonly failures = new Map<string, { record: FailureRecord; count: number }>();

  skip(reason: SkipReason, count = 1): void {
    if (count <= 0) {
      return;
    }
    this.skips.set(reason, (this.skips.get(reason) ?? 0) + count);
  }

  fail(stage: FailureStage, reason: FailureReason, detail?: string): void {
    const key = `${stage}|${reason}|${detail ?? ""}`;
    const existing = this.failures.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }
    // `detail` is ABSENT when there is none, never null or "" — Constitution, Observability &
    // Logging: "Fields outside a record's scope MUST be ABSENT".
    const record: FailureRecord =
      detail === undefined ? { stage, reason, count: 1 } : { stage, reason, count: 1, detail };
    this.failures.set(key, { record, count: 1 });
  }

  build(status: RunOutcome["status"], durationMs: number, budgetExhausted: boolean): RunOutcome {
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
      failures: [...this.failures.values()].map(({ record, count }) =>
        record.detail === undefined
          ? { stage: record.stage, reason: record.reason, count }
          : { stage: record.stage, reason: record.reason, count, detail: record.detail },
      ),
      durationMs,
      budgetExhausted,
    };
  }
}
