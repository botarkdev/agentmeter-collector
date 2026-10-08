# Data model: Claude Code collector

**Feature**: `0019-claude-code-collector`

Nothing here is stored in a database. These are the shapes that pass between the modules of
`packages/collector`, plus the two things it writes to a developer's disk. They are documented
because the boundary between them is where the content-safety property lives: a transcript object
exists on one side of `UsageTurn` and never on the other.

## In-memory

### `UsageTurn` — the only thing carried out of a transcript

```ts
interface UsageTurn {
  readonly messageId: string;     // becomes idempotencyKey
  readonly occurredAt: string;    // the event's ISO timestamp, verbatim
  readonly sessionId?: string;
  readonly model: string;
  readonly tokens: TokenCounts;
}

interface TokenCounts {
  readonly input: number;
  readonly output: number;
  readonly cacheWrite5m: number;
  readonly cacheWrite1h: number;
  readonly cacheRead: number;
}
```

Five fields and five counters. `usage-extraction.ts` produces this from a parsed transcript line
and is the **only** module that ever holds a transcript object; everything downstream sees this
type and cannot reach anything else. The transcript's `cwd`, `gitBranch`, `slug`,
`attributionSkill`, `entrypoint`, `error`, `uuid`, `parentUuid`, `version` and the whole of
`message.content` have no representation here, so there is no path by which they travel.

Extraction returns either a turn or a `SkipReason` (contracts/run-outcome.md). It never throws
and never partially fills a turn.

### `MeasurementEntry` and `IngestBatch` — the wire shapes

Exactly the endpoint's contract, no more: see `contracts/ingest-submission.md`. Built field by
field by `measurement-projection.ts` from a `UsageTurn` plus the configured tier. The projection
takes named arguments, not an object to spread, which is what makes "a new transcript field
cannot reach the wire" true by construction rather than by review.

### `CollectorConfig`

```ts
interface CollectorConfig {
  readonly endpoint: string;          // AGENTMETER_ENDPOINT
  readonly token: string;             // AGENTMETER_TOKEN
  readonly pricingTier: string;       // AGENTMETER_PRICING_TIER, default "standard"
  readonly transcriptsDir: string;    // AGENTMETER_TRANSCRIPTS_DIR, default ~/.claude/projects
  readonly cacheDir: string;          // AGENTMETER_CACHE_DIR, default per XDG
  readonly maxBatchSize: number;      // AGENTMETER_MAX_BATCH_SIZE, default 200
  readonly maxQueuedBatches: number;  // AGENTMETER_MAX_QUEUED_BATCHES, default 512
  readonly runBudgetMs: number;       // AGENTMETER_RUN_BUDGET_MS, default 5000
  readonly requestTimeoutMs: number;  // AGENTMETER_REQUEST_TIMEOUT_MS, default 2000
}
```

`resolveConfigFromEnv` returns a config or the reason it could not: a missing endpoint or token
yields `not-configured`, which is a successful no-op run, not a failure. A numeric variable that
is not a positive integer falls back to its default and records a `config` failure — a typo in a
tuning variable must not stop a developer's metrics from being collected.

`token` is never copied into any other structure, never printed, and never written to disk.

### `RunOutcome`

`contracts/run-outcome.md`. The whole of the collector's observable behaviour.

## On disk

Both live under `cacheDir`, default `${XDG_CACHE_HOME:-$HOME/.cache}/agentmeter`. Both are
disposable: deleting either loses no measurement that the service has already accepted, and
costs only a re-read (research.md Decision 8).

### Queue: `queue/<epoch-millis>-<random>.json`

One file per undelivered batch, written to `<name>.tmp` and renamed into place, so a name that
exists is a file that is complete (FR-017). The content is exactly the request body that will be
sent — `{ agent, measurements }` — and nothing else. Notably **not** the token, and not the
endpoint: a queue file written under one configuration is delivered under whatever configuration
the next run resolves, which is what makes rotating a token or moving an endpoint recover the
backlog rather than strand it.

Ordering is lexicographic by name, which is chronological by construction. A file that cannot be
parsed is removed and recorded as `queue-item-unreadable` rather than blocking the drain forever.

The ceiling (`maxQueuedBatches`) is enforced when enqueuing: oldest names are removed first, and
the count of removals is reported (FR-022).

### Cursor: `scan-cursor.json`

```ts
interface ScanCursor {
  readonly version: 1;
  readonly files: Record<string, { size: number; mtimeMs: number; offset: number }>;
}
```

The key is the transcript's absolute path. This file therefore *does* contain paths — it is the
one structure that must, since its whole job is to remember which file was read to where. It is
never transmitted, never included in the outcome, and never written into a queue file; it stays
on the developer's machine, in their own cache directory, alongside the transcripts whose paths
it names.

A cursor that is missing, unparsable or of an unknown version is treated as empty. A file whose
recorded size or mtime no longer matches is re-read from zero, so truncation and rotation are
handled without a special case. Entries for files that no longer exist are dropped on write, so
the cursor cannot grow forever.
