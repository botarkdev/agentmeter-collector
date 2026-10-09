# C002 — Attribution rules a repository declares

**Status**: plan, awaiting approval. Nothing but this document and its index row has been written.

**This plan asks for a change to rule 2** ("It sends metrics, never content"). Today nothing
derived from the git branch is transmitted, and the wire has six fields. Every option below other
than "do not build it" puts a seventh field on the wire, `dimensions`, whose values a repository's
own committed rules derive from the branch name. That is a weakening of the rule as it is written,
it is said here as such, and it is the owner's decision — the questions marked **[owner, rule 2]**
below. Nothing is built until they are answered.

## What exists today

- **The wire.** One measurement is `idempotencyKey`, `occurredAt`, `sessionId` (optional), `model`,
  `pricingTier`, `tokens` (five counters). `src/contract/measurement-projection.ts` writes each by
  name; `MEASUREMENT_ENTRY_FIELDS` lists them; `test/unit/contract/content-safety.unit.test.ts`
  fails when the key set differs or when a marker planted in any content-bearing transcript field
  reaches the serialised batch.
- **What a turn carries locally.** A Claude Code transcript event records, beside the usage, the
  working directory (`cwd`) and the branch that was checked out when the turn ran (`gitBranch`).
  `src/claude-code/usage-extraction.ts` is the only module that holds the event. It reads `cwd` to
  hand it to the scope and drops it; it does not read `gitBranch` at all. `UsageTurn` has no field
  either could travel in.
- **What the service accepts.** Its ingestion contract already defines an optional `dimensions`
  array on a measurement, each element `{ type, key, weight?, confidence? }`: `type` and `key` are
  non-empty strings with no vocabulary and no length limit, `weight` defaults to 1 when absent,
  and the entry admits no other field. The service stores a measurement against
  `project × type × key (× user)` and does not interpret either string. **The service needs no
  change for anything in this plan.**
- **Two properties of the service that shape the plan**, both already relied on by the collector:
  a measurement is identified by its idempotency key alone, and a key that is sent again is
  deduplicated — the first delivery's dimensions stay, the second's are not applied. So
  **attribution is decided at first delivery**; the collector cannot relabel what it has already
  delivered. (Relabelling exists on the service as a separate, authenticated operation; it is not
  the collector's.)
- **Configuration.** Every value comes from the environment (`src/config/collector-config.ts`).
  There is no committed file. The repository a run belongs to is already found without spawning
  anything (`src/scope/repository-root.ts`).

## Behaviour

A repository commits a file, `.agentmeter.json`, at its root. The file holds attribution rules and
nothing else. Each rule names a source the collector can read locally, a regular expression over
it, and the dimensions to emit when it matches:

```json
{
  "version": 1,
  "attribution": [
    {
      "from": "branch",
      "match": "^(?<task>[A-Z][0-9]{3})-",
      "emit": [{ "type": "task", "key": "{task}" }]
    }
  ]
}
```

With that file, a turn that ran on the branch `K123-add-export` is submitted as:

```json
{
  "agent": "claude-code",
  "measurements": [
    {
      "idempotencyKey": "msg_01EXAMPLEEXAMPLEEXAMPLE00",
      "occurredAt": "2026-10-09T10:00:00.000Z",
      "sessionId": "00000000-0000-4000-8000-000000000000",
      "model": "claude-opus-5",
      "pricingTier": "standard",
      "tokens": {
        "input": 2,
        "output": 348,
        "cacheWrite5m": 0,
        "cacheWrite1h": 7028,
        "cacheRead": 20628
      },
      "dimensions": [{ "type": "task", "key": "K123" }]
    }
  ]
}
```

`add-export` is not sent: no rule captured it. A turn on `main` matches no rule and is submitted
exactly as today, with no `dimensions` key at all. A repository with no `.agentmeter.json` sends
exactly what it sends today.

### Exactly what would leave the machine (recommended option)

| On the wire | Value | Derived from |
| --- | --- | --- |
| `dimensions[].type` | a string | **A constant** written in the committed file. Never from the machine: `type` admits no placeholder. |
| `dimensions[].key` | a string, 1–128 characters | The rule's `key` template from the committed file: its literal text, with each `{name}` replaced by the text the rule's regular expression captured in the named group `name` **from the branch name recorded on that turn**. |

Nothing else is new. Specifically, **never derived and never sent**, under any rule a file can
express:

- the working directory, any path or path segment, the transcript's location, the repository's
  name or root;
- message content, tool input or output, file contents, `slug`, `entrypoint`, `error`, `uuid`;
- the branch name as such. The only way any part of it reaches the wire is a named capture group
  of a pattern the repository committed. A repository that writes `^(?<all>.+)$` with
  `"key": "{all}"` does send the whole branch name: that is what it declared, in a public,
  reviewed file. Nothing sends it by default;
- `weight`, `confidence`, `payload`, a project or a user identity;
- anything at all when the file is absent, unreadable, or not valid.

The branch is the one recorded **on the turn** when it was written, not the branch checked out
when the collector runs: a run reads history, and a session that ends on `main` may hold turns of
three branches.

### The file

- **Where**: `.agentmeter.json` in the root of the repository the run belongs to — the same root
  the scope already finds (`findRepositoryRoot`): the main working tree, also for a session opened
  in a linked worktree. One repository, one rule set per run.
- **Format**: JSON, read with `JSON.parse`. No dependency (rule 3).
- **Keys**: `version` (must be `1`) and `attribution` (an array of rules). A rule has `from`
  (must be `"branch"`), `match` (a regular expression, as text) and `emit` (an array of
  `{ "type", "key" }`). **Any other key anywhere makes the whole file invalid** — see
  "Fail closed" below. In particular `endpoint`, `token` and `project` are not keys of this file:
  they stay in the environment, and a file carrying one is invalid rather than half-obeyed.
- **Evaluation**: rules are tried in order; **the first that matches wins** and emits all of its
  `emit` entries. An entry whose placeholder names a group that did not take part in the match, or
  whose key comes out empty or longer than 128 characters, is dropped; the others are kept. Two
  identical `(type, key)` in one measurement are sent once.
- **Limits**, all checked when the file is read: at most 64 KiB, 32 rules, 8 `emit` entries per
  rule, 512 characters per pattern, 64 per `type`, 128 per `key` template. A branch name longer
  than 255 characters is not matched.
- **Machine scope** (`AGENTMETER_SCOPE=machine`): no file is read and no dimension is sent. Such a
  run reports many repositories, and one repository's rules must not label another's turns.

### How the four rules are kept

1. **It can never fail or block a session.** Reading and validating the file never throws; every
   failure is a record in the run's outcome. A regular expression committed by a repository can
   backtrack without bound, and a synchronous match cannot be abandoned by the run's budget — so
   every match runs through `node:vm` with a 50 ms timeout (a Node built-in; verified on Node 22:
   `/^(a+)+$/` against 40 characters is interrupted after 52 ms with
   `ERR_SCRIPT_EXECUTION_TIMEOUT`; 1 000 guarded matches of an ordinary pattern take about
   100 ms). Results are memoised per distinct branch name, so a run evaluates the rules a handful
   of times. After the first timeout the rules are switched off for the rest of the run, the
   remaining turns are sent without dimensions, and the run says so.
2. **Metrics, never content — amended, and still enforced by construction.**
   - `usage-extraction.ts` stays the only module that holds a transcript event. It reads
     `gitBranch`, hands it to an attribution function it was given — exactly as it hands `cwd` to
     the scope — and drops it. `UsageTurn` gains `dimensions`, a list of `{ type, key }`; it still
     has no field a branch name or a path could travel in.
   - The attribution function's input type has one field, `branch`. There is no way to write a
     rule over anything else: `from` is a closed set of one value, and a file naming another is
     invalid.
   - `projectMeasurement` writes `dimensions` out by name, rebuilding each element as
     `{ type, key }` — nothing spread, nothing passed through. `MEASUREMENT_ENTRY_FIELDS` gains
     `dimensions`; a new `DIMENSION_FIELDS = ["type", "key"]` is exported beside it.
   - **Fail closed**: an unknown key, an unknown `version`, an unknown `from`, a placeholder that
     names no group, a pattern that does not compile, or a limit exceeded makes the whole file
     invalid, and an invalid file means **no dimensions at all**. This is what lets C003 add a
     privacy key later without an older collector ignoring it and sending the value in clear.
3. **Zero runtime dependencies.** `node:fs`, `node:path`, `node:vm`, `JSON.parse`. Nothing added
   to `package.json`.
4. **The service is the authority.** The collector sends two strings per dimension and
   re-validates nothing of the service's. The vocabulary (`task`, `spec`, anything) is the
   repository's, in its own file; neither the collector nor the service knows what the words mean.

### What an invalid or unreadable file does

The run continues and **submits its measurements without dimensions**, and reports one failure:
stage `attribution`, reason `invalid-rules` (with a closed-vocabulary `detail` naming the check
that failed — `not-json`, `too-large`, `unknown-key`, `unsupported-version`, `unknown-source`,
`invalid-pattern`, `unknown-placeholder`, `limit-exceeded` — never file content, a pattern or a
branch), `unreadable-rules`, or `rule-timeout`. An absent file is not a failure: it is every
repository that never opted in.

The cost is stated plainly: those turns are delivered unlabelled and the collector cannot label
them afterwards. The alternative — hold everything until the file is fixed — risks the tokens
themselves, because transcripts rotate off disk. Tokens cannot be recovered; labels can be
re-applied on the service.

### What the run reports

`RunOutcome.scan` gains `turnsAttributed` (turns that received at least one dimension), printed by
`agentmeter push` as `attributed N` when not zero. `FailureStage` gains `attribution`;
`FailureReason` gains `invalid-rules`, `unreadable-rules` and `rule-timeout`. No outcome field
carries a dimension's value, a branch or a pattern.

## Decisions needed

### [owner, rule 2] — what may leave the machine

**O1. May the collector send `dimensions` at all?** This amends rule 2 in `CLAUDE.md` and
`README.md` and reverses, in part, FR-025 and research Decision 12 of the design record (which is
not edited: the reversal is its own document, as the repository scope's was).
_Recommended: yes_, only for a repository that committed a rule file, with the fields and
derivations of the table above. _Alternative: no_ — C002 is discarded or parked, and C003 with it.

**O2. What may a rule read?**

- **(a) The turn's recorded branch name only** — _recommended_. It is what the task names, it is
  one string with a known shape, and it is what the reference repository's attribution uses.
- (b) The branch, and the turn's working directory relative to the repository root (for a
  monorepo: `apps/api`). Costs: a second derived value from a path, which rule 2 singles out; and
  it is unreliable — a turn in a linked worktree outside the root, or one selected by its
  transcript's location, has no meaningful relative path. Not recommended here; it can be its own
  task once (a) is in use.

**O3. How much of the branch may a rule send?**

- **(a) Whatever its named capture groups capture, up to 128 characters** — _recommended_. A
  repository can therefore choose to send whole branch names by writing a pattern that captures
  everything; it is visible in its committed file, and C003 is where omitting or hashing is added.
- (b) As (a), but a dimension whose captured text is the entire branch name is dropped, until C003
  exists. Costs: a rule a reader would expect to work silently emits nothing; and it is trivially
  sidestepped (`^(?<a>.)(?<b>.*)$` with `"{a}{b}"`), so it protects against accident, not intent.

**O4. Which fields of a dimension are sent?**

- **(a) `type` and `key` only** — _recommended_. The service defaults `weight` to 1.
- (b) Also a constant `confidence` and/or `weight` written in the file. Nothing derives either
  today; adding them later is a compatible change.

**O5. What does a turn that matches no rule send?**

- **(a) No `dimensions` key at all** — _recommended_; it is byte-for-byte today's entry. A
  repository that wants a default writes a last rule that matches everything and emits a constant
  key, which needs no feature.
- (b) A built-in default dimension. Costs: the collector would invent vocabulary, which rule 4
  says it must not.

### [scope of the row] — the owner should see it; the design record already argues it

**S1. Granularity.** The row says the file declares "the granularity it reports at". _Recommended:
not in this task, and no `granularity` key in the file._ The collector reports one measurement
per turn, keyed by the turn's id. A per-session measurement would be keyed by the session, and the
service deduplicates on the key: a session that is resumed, or reported while still running, grows
after its key was first delivered and **the additional tokens are silently lost** (research
Decision 1 of the design record measured 404 turn ids appearing under more than one session). It
also needs whole-file aggregation where the scan is incremental. That is a different feature with
a correctness problem to solve first; if wanted, it should be a task of its own. _Alternative:_
accept `"granularity": "event"` as the only legal value now, so the key exists; it adds a key that
does nothing.

### Ordinary plan decisions — the orchestrator may answer

**P1. Where the file is read from.** _Recommended: the root the scope uses (main working tree)._
Alternatives: the root of the working tree the run started in (a branch could carry its own rules,
but the run labels every worktree's turns with whichever worktree happened to run it); or a path
in an environment variable (the rules would stop being a committed declaration).

**P2. An invalid file.** _Recommended: submit without dimensions and report_ (above).
Alternative: collect nothing until it is fixed — no unlabelled turns, but usage is at the mercy of
transcript rotation.

**P3. Unknown keys.** _Recommended: the whole file is invalid_ (fail closed, above). Alternative:
ignore them — friendlier, and exactly what would let an older collector skip a future privacy key.

**P4. Several matching rules.** _Recommended: first match wins_, so a specific rule placed before
a general one shadows it. Alternative: every matching rule emits — then "more specific first"
cannot be expressed and a general rule always adds its dimension.

**P5. Bounding a committed regular expression.** _Recommended: `node:vm` with a timeout_, as
above. Alternatives: a pattern language of the collector's own that matches in linear time (more
code, less expressive, another thing to document); or no bound, on the argument that whoever can
commit the file can commit the hook command too (leaves rule 1 resting on trust).

**P6. The limits** in "The file" (64 KiB, 32 rules, 8 emits, 512/64/128/255 characters, 50 ms).
Any of them can change without changing the design.

## Acceptance criteria

1. With no `.agentmeter.json` in the repository root, every submitted measurement has exactly the
   six fields it has today and no `dimensions` key; no failure is recorded for the absence.
2. With a valid file whose rule matches a turn's recorded branch, the measurement carries
   `dimensions`, each element having exactly the keys `type` and `key`, with `key` built from the
   template and the named captures; `type` is the file's literal.
3. A turn whose branch matches no rule, or that records no branch, has no `dimensions` key.
4. Rules are tried in order and only the first matching rule emits.
5. An `emit` entry whose placeholder group did not take part in the match, or whose key is empty
   or longer than 128 characters, is dropped; the rule's other entries are sent; identical
   `(type, key)` pairs are sent once.
6. A file that is not JSON, exceeds a limit, has an unknown key at any level (including
   `endpoint`, `token`, `project`, `granularity`), a `version` other than `1`, a `from` other than
   `"branch"`, a pattern that does not compile, a placeholder in `type`, or a `key` placeholder
   naming no group of its pattern, yields **no dimensions on any measurement** and one
   `attribution` / `invalid-rules` failure whose `detail` is one of the closed codes. The
   measurements are still submitted.
7. A file that exists and cannot be read yields no dimensions and one `attribution` /
   `unreadable-rules` failure; the measurements are still submitted.
8. A pattern that backtracks without bound is interrupted; the run records one `attribution` /
   `rule-timeout` failure, sends the remaining turns without dimensions, and `runCollector` still
   resolves. No test asserts on elapsed real time.
9. `runCollector` never rejects and `agentmeter push` exits 0 for every case in 6–8.
10. With `AGENTMETER_SCOPE=machine` no rule file is read and no measurement carries `dimensions`.
11. Content safety, extended (see below): under a rule set that captures part of the branch, no
    marker planted in any transcript field — the working directory and the branch included —
    appears in the serialised batch; under a rule set that deliberately captures the whole branch,
    the branch marker appears inside `dimensions[].key` and nowhere else, and every other marker
    is still absent.
12. The entry's key set equals `MEASUREMENT_ENTRY_FIELDS` (now including `dimensions`) when a
    dimension is present and equals it minus `dimensions` when none is; each dimension's key set
    equals `DIMENSION_FIELDS`.
13. `UsageTurn` and everything downstream of extraction never hold the branch name: a turn
    extracted with an attribution function serialises without the branch marker unless a rule
    captured it.
14. `scan.turnsAttributed` counts the turns that received at least one dimension, and
    `agentmeter push` prints it when it is not zero. No failure `detail` and no outcome field
    contains a branch name, a pattern or a dimension value.
15. A queued batch holds the dimensions computed when it was collected, and is delivered with
    them by a later run.
16. `package.json` has no `dependencies`; `pnpm test:cov`, `pnpm build`, `pnpm check:package`,
    `pnpm format:check` and `pnpm typecheck` pass, coverage thresholds unchanged.

## How the enforcement is extended, not promised

- `src/contract/measurement-projection.ts`: `MEASUREMENT_ENTRY_FIELDS` gains `"dimensions"`;
  `DIMENSION_FIELDS` is added; `projectMeasurement` builds `dimensions` element by element from
  named properties, and omits the key when there is none.
- `test/unit/contract/content-safety.unit.test.ts`:
  - the existing assertions stay for a run with no rules, including "sends no dimensions";
  - the marker fixture's branch becomes `K123-<branch marker>`; a "partial capture" block asserts
    `K123` is sent and no marker is;
  - a "whole capture" block asserts the branch marker occurs exactly once in the serialised batch,
    at `measurements[0].dimensions[0].key`;
  - a block asserts a rule file naming `cwd`, or any source but `branch`, is invalid and produces
    no dimensions — so a path cannot be made to travel by configuration;
  - the key-set equality assertions cover the entry and each dimension.
- `test/unit/support/transcripts.ts`: `assistantTurn` gains an optional `gitBranch`.

Each new assertion is watched failing before the implementation that satisfies it, as the
repository's testing rule requires.

## Affected areas

| Path | Change |
| --- | --- |
| `src/attribution/attribution-rules.ts` (new) | Reads and validates `.agentmeter.json`; compiles rules; the guarded, memoised matcher; returns an attribution function or a failure code. Pure apart from the injected file read. |
| `src/claude-code/usage-extraction.ts` | `extractUsageTurn` takes an optional attribution function, reads `gitBranch`, hands it over and drops it. `UsageTurn` gains optional `dimensions`. Header comment updated. |
| `src/contract/ingest-contract.ts` | `MeasurementEntry` gains optional `dimensions`; `WireDimension` type. Comment updated. |
| `src/contract/measurement-projection.ts` | As above. |
| `src/run/collect.ts`, `src/run/run-collector.ts` | Load the rules once per run for a repository-scoped run (injected dependency), pass the attribution function down, count `turnsAttributed`, record failures. |
| `src/run/run-outcome.ts` | `turnsAttributed`; the new stage and reasons. |
| `src/cli/run-cli.ts` | Prints `attributed N`. |
| `src/index.ts` | Exports the new public types; header comment updated. |
| `test/unit/…` | A new `attribution/attribution-rules.unit.test.ts`; additions to the extraction, projection, content-safety, collect, run-collector, run-outcome and CLI suites; the fixture helper. |
| `specs/attribution-rules/decision.md` (new) | What was decided and by whom, exactly what leaves the machine, what it reverses of the design record (FR-025 in part, research Decision 12), known limits. |
| `README.md` | Rule 2's paragraph; a new "Attribution" section with the file format, limits and failure behaviour; the outcome fields. |
| `CLAUDE.md` | Rule 2 reworded to the amended statement; layout table gains `src/attribution/`; "Key documents" gains the decision; "Not here yet" loses C002; "Configuration" says what the one committed file may hold. |
| `CHANGELOG.md` | `[Unreleased]` entries. The version is not raised here. |
| `docs/features/` | This document and its index. |
| `TASKRAIL.md` | C002's row, through the CLI. |

Not touched: `LICENSE`, `specs/0019-claude-code-collector/`, `package.json` dependencies, the
queue, the cursor, the transport, the workflows.

## Out of scope

- **Omitting or hashing a dimension** — C003. This plan only makes sure a future privacy key
  cannot be silently ignored (fail closed).
- **A second agent adapter** — C004. The attribution function takes `{ branch }`, not a Claude
  Code event, so another adapter can feed it.
- **Session granularity** (S1), and any change to the idempotency key.
- **Sources other than the branch** (O2 b): working directory, paths, time windows, commit data.
- **Relabelling what was already delivered**, and backfilling history from before the file
  existed.
- **`weight` / `confidence`**, splitting one turn across several keys of a type.
- **Anything on the service.** It already accepts the field.
- **Putting the endpoint, the token or the scope in the file.**

## Open questions and risks

- **Attribution is decided at first delivery.** Turns delivered before the file existed, or while
  it was invalid, stay unlabelled; deleting the scan cursor does not change that, because the
  service keeps the first delivery. To be stated in the decision document and the README.
- **The same turn on two lines with two branches.** A turn id can appear on several transcript
  lines (the run keeps the one with the greatest token total, the first on a tie). If those lines
  record different branches, the kept line's dimensions are the ones sent. Rare, and documented as
  a known limit rather than solved.
- **A dimension value sits in the on-disk queue** until delivered, in the cache directory, like
  the rest of the request body. It never held a token and still does not.
- **The main working tree may not have the file a branch added.** Under P1's recommendation rules
  take effect when they reach the main working tree's checkout.
- **`node:vm` is a boundary for time, not for trust.** It is used only to interrupt a match; the
  pattern is data, never code, and is compiled with `new RegExp` outside the context.
- **The recorded branch of a detached checkout** is whatever Claude Code wrote (observed: the
  literal `HEAD`). It is matched like any other text; a repository's patterns will not match it
  unless written to.
- **Size.** If O2 (b) or session granularity were approved into this task, it would no longer fit
  one short plan and should be split.

## What was read from the service's repository

Only shapes the collector must send, and one behaviour it relies on: that a measurement admits an
optional `dimensions` array of `{ type, key, weight?, confidence? }` and no unknown field; that
`weight` defaults to 1; that neither string has a vocabulary; and that a deduplicated key keeps
its first delivery's dimensions. The file name `.agentmeter.json` and the `from` / `match` / `emit`
shape with `{name}` placeholders follow the service's architecture proposal, which sketched the
client's configuration; nothing else of that document is reproduced.
