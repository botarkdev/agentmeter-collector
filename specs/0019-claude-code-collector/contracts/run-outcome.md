# Contract: the run outcome

**Feature**: `0019-claude-code-collector`

FR-015 forbids the collector every ordinary way of saying something went wrong: it may not throw,
may not exit non-zero, and may not write to a stream the agent session treats as failure. So the
outcome it returns is not a convenience — it is the *only* channel by which anything about a run
is observable, and a field missing from it is a failure mode nobody can see. That is why this is
a contract rather than a return type.

```ts
interface RunOutcome {
  readonly status: "collected" | "not-configured";
  readonly scan: ScanSummary;
  readonly delivery: DeliverySummary;
  readonly queue: QueueSummary;
  readonly skipped: readonly SkipRecord[];
  readonly failures: readonly FailureRecord[];
  readonly durationMs: number;
  readonly budgetExhausted: boolean;
}

interface ScanSummary {
  readonly filesConsidered: number;   // transcripts found
  readonly filesRead: number;         // those the cursor did not let us skip
  readonly linesRead: number;
  readonly turnsFound: number;        // assistant turns carrying usage
  readonly measurements: number;      // after in-run deduplication
  readonly duplicatesCollapsed: number;
}

interface DeliverySummary {
  readonly batchesSent: number;
  readonly accepted: number;
  readonly deduplicated: number;
  readonly rejected: number;
}

interface QueueSummary {
  readonly enqueued: number;   // batches written by this run
  readonly remaining: number;  // batches still on disk when the run ended
  readonly discarded: number;  // dropped to hold the ceiling, or declared permanently invalid
}

interface SkipRecord {
  readonly reason: SkipReason;
  readonly count: number;
}

type SkipReason =
  | "unparsable-line"      // a truncated or malformed JSON line
  | "missing-key"          // no message id to key on (FR-008)
  | "missing-timestamp"    // no usable occurrence instant (FR-009)
  | "missing-model"
  | "invalid-token-counts" // a counter present but not a non-negative integer
  | "zero-token-turn";     // nothing to measure (research.md Decision 3)

interface FailureRecord {
  readonly stage: "config" | "scan" | "queue" | "cursor" | "transport";
  readonly reason: FailureReason;
  readonly detail?: string;
}

type FailureReason =
  | "invalid-setting"       // a tuning variable that is not a positive integer; detail names it
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
```

## Rules this shape enforces

- **Counts, codes and durations only.** No free text derived from a transcript, no file path, no
  URL, no token, no branch. `detail` exists for a code the *service* supplied — an error `code`
  from the documented error contract, or a stated wait in seconds — and never for anything read
  from disk. This is why a failure record cannot become a content leak on a developer's terminal
  (FR-025, FR-027).
- **Skips are counted, not swallowed.** Every skip reason a run encountered appears with its
  count, so US4's "observable to whoever asks" is a property of the type rather than a habit.
- **`status: "not-configured"`** is a success. A `SessionEnd` hook fires in repositories that
  never opted in; that is a no-op, not an error, and it must not print anything alarming.
- **`budgetExhausted`** is separate from every other field because "we ran out of time" and "we
  finished" produce the same counts and mean very different things next run.
- **Nothing in this type is optional-because-unknown.** A count the run could not determine is 0,
  and the failure that prevented determining it is in `failures`.

## The CLI's use of it

`runCli` prints one line built from these counts and returns `0`. Always `0` — the exit code of a
`SessionEnd` hook is not a place to report anything, because the only reader is the agent session
this feature must never disturb.
