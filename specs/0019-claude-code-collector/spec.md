---
type: feature
---

# Feature Specification: Claude Code collector

**Feature Branch**: `0019-claude-code-collector`

**Created**: 2026-08-20

**Status**: Draft

**Input**: User description: "Scan Claude Code JSONL transcripts, normalise to the ingest
contract, queue to disk, send. Must never block or fail an agent session." (TODO.md row T004)

## Why this exists

Today a developer's token spend is measured by a ~1200-line script committed inside their own
repository, which rescans local transcripts and rewrites generated markdown into the working
tree (`docs/00-architecture-proposal.md` §1). This feature is the piece that replaces it: the
part that runs on the developer's machine, reads what Claude Code already wrote down, and hands
it to the service.

Everything about it is shaped by two facts. First, it runs inside a `SessionEnd` hook, so a
developer experiences it as the thing standing between them and their prompt returning — a
collector that occasionally hangs a session close gets uninstalled, and then it measures nothing
at all (Constitution, Principle IV). Second, the transcripts it reads are the developer's source
code, prompts, file contents and secrets. The service is about to be public. What leaves the
machine has to be a small, fixed set of counters and identifiers, and that has to be a property
someone can check, not a promise in a comment.

## Clarifications

### Session 2026-08-20

This feature was specified under autopilot (Constitution, "Autopilot mode"): no human was
available at the clarification gate, so each question below was answered by the lane and the
reasoning recorded here for the deferred review that gate becomes. Each names the options that
were genuinely on the table, because an answer without them reads afterwards as if nothing was
decided.

- **Q: At what granularity is a measurement recorded — one per assistant turn, or one per
  session-and-model bucket?** → **A: one per assistant turn.**

  Both are legitimate under the service's contract; the architecture proposal uses the turn key
  in its own example payload and the session-bucket key in its migration plan, and §7.3 warns
  that turn granularity is the expensive one. It is chosen anyway because it is the only one
  whose key is *complete when it is written*. A session bucket's counts keep growing while the
  session is alive and grow again when a session is resumed, but the service's ledger is keyed on
  the idempotency key alone: the second, larger send of the same bucket is deduplicated and the
  additional tokens are lost with no error anywhere. A turn is final the moment it is written, so
  a replay is genuinely a no-op rather than a silent truncation. The cost — row volume — is
  bounded by batching and is recoverable later; the lost tokens are not.

- **Q: Which pricing tier does the collector assert, given it holds no price table?** → **A: a
  configured tier, defaulting to `standard`.**

  The service requires a tier and treats it as the client's assertion, with a price entry's
  intro cutoff explicitly informational rather than selective
  (`specs/0014-pricing-cost-calc/spec.md` FR-005, FR-007). The collector therefore cannot compute
  the tier, and centralising pricing means it must not carry a price table to do so. Sending
  `unknown` was rejected: the tier is stored on the immutable measurement, so every measurement
  would be permanently unpriced and not even retroactive repricing (T008) could rescue it.
  `standard` is the correct assertion for every model outside an introductory window, and a
  caller who knows better can override it. That the collector cannot resolve an introductory
  window without the service publishing one is a real gap, and it belongs to the pricing feature,
  not to this one.

- **Q: Where does configuration come from?** → **A: the caller's environment only.**

  A repository declaring its endpoint, granularity and rules in a committed file is T013's whole
  subject. Building a file format here would have to be redesigned there. The endpoint and token
  are environment values and are never committed (Constitution, Environment Configuration).

- **Q: Does this feature ship a runnable entry point, or only a library?** → **A: a library, plus
  one thin binary over it.**

  "Never blocks or fails an agent session" is a property of a process, not of a function: exit
  code, output streams and wall-clock budget are only observable when something runs. A library
  alone could not be shown to satisfy FR-014 or FR-015. The binary is kept to a wrapper with no
  logic of its own so that T013 can put configuration in front of it without unpicking anything.

- **Q: How long may a run take, and how long may one request take?** → **A: 5 seconds per run and
  2 seconds per request, both overridable.**

  The proposal requires "a short timeout" without naming one. These are chosen as defaults rather
  than constants: 5 seconds is comfortably inside what a session close absorbs unnoticed while
  still allowing several batches on a healthy connection, and a 2-second request timeout means a
  hung service costs one such wait rather than the whole budget.

- **Q: How is undelivered work retained — one growing file, or one file per batch?** → **A: one
  file per batch.**

  Two `SessionEnd` hooks can fire at the same moment. Appending to a shared file interleaves and
  corrupts it, and defending that needs a lock, which is one more thing that can hang a session
  close. Separate files created by write-then-rename need no lock at all: a partially written
  file never has a final name, which is FR-017, and two runs never touch the same name, which is
  FR-016.

- **Q: Is the retention ceiling a count or a size?** → **A: a count of retained batches.**

  A count is enforceable when enqueuing without measuring anything on disk, and each batch is
  already bounded by the per-request entry limit — so bounding the count bounds the bytes, while
  bounding the bytes would not bound the work a run has to do.

- **Q: Does the collector keep local state to avoid re-reading transcripts?** → **A: yes, and
  correctness never depends on it.**

  Principle III permits local state as a performance optimisation only. Without it, every session
  close rescans every transcript a developer has ever produced, which is precisely how this
  collector would come to violate Principle IV on a machine with a year of history. Deleting the
  state re-reads and resubmits; the service's ledger deduplicates the result, so the only
  consequence is a slower run.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Usage arrives with no action from the developer (Priority: P1)

A developer finishes a Claude Code session in a repository that has agentmeter wired into its
`SessionEnd` hook. Without them doing anything, noticing anything, or waiting for anything, the
token counts for the assistant turns of that session reach the service and appear against their
project.

**Why this priority**: This is the feature. Everything else exists to make this survivable when
it goes wrong. If only this story is delivered, a developer with a reachable service and a valid
token gets what the in-repo script used to give them, without committing anything.

**Independent Test**: Point the collector at a directory of Claude Code transcripts and at a
service endpoint that records what it receives; run the collector once; verify the service
received one measurement per distinct assistant turn, carrying that turn's five token counts.

**Acceptance Scenarios**:

1. **Given** transcripts containing assistant turns with usage, **When** the collector runs,
   **Then** each distinct turn is submitted exactly once with its input, output, cache-write-5m,
   cache-write-1h and cache-read token counts.
2. **Given** a transcript line that is not an assistant turn, or an assistant turn carrying no
   usage, **When** the collector runs, **Then** nothing is submitted for it.
3. **Given** a run that submitted successfully, **When** the collector runs again over the same
   unchanged transcripts, **Then** the service reports the resubmitted measurements as
   deduplicated and the recorded totals are unchanged.

---

### User Story 2 - The service is unreachable and nothing is lost or noticed (Priority: P1)

A developer works on a train, or the service is being redeployed, or their token expired
overnight. Their session ends. Nothing tells them anything is wrong, nothing takes longer than
usual, and when connectivity comes back the usage from those sessions arrives.

**Why this priority**: Equal first with US1, because the unreachable case is the normal case,
not the exception — a laptop is offline more often than a server is down. A collector that only
works when the network does is a collector that silently under-reports and nobody finds out.

**Independent Test**: Run the collector with the service refusing connections; verify the run
ends quickly and reports success to its caller; then run it again with the service accepting,
and verify the earlier measurements arrive.

**Acceptance Scenarios**:

1. **Given** an endpoint that refuses connections, **When** the collector runs, **Then** the run
   completes without raising, without a non-zero exit, and the measurements are retained on
   disk.
2. **Given** an endpoint that never answers, **When** the collector runs, **Then** the run
   abandons the attempt once its time budget is spent and retains the measurements on disk.
3. **Given** retained measurements from an earlier failed run, **When** a later run finds the
   service reachable, **Then** those measurements are submitted before the ones discovered in
   that run.
4. **Given** the service accepts a submission, **When** the run finishes, **Then** the submitted
   measurements are no longer retained on disk and are not submitted again by a later run.

---

### User Story 3 - Nothing derived from message content ever leaves the machine (Priority: P1)

A developer's transcripts contain proprietary source, customer data, and the contents of their
`.env` files as pasted into a prompt. They send usage metrics to a public service. Nothing of
that reaches it.

**Why this priority**: Equal first, because it is the only failure in this feature that cannot
be undone. A lost measurement is a missing row; a leaked prompt is a leak to strangers, and no
later fix retracts it.

**Independent Test**: Build a transcript whose every content-bearing field contains a distinctive
marker string, run the normalisation over it, and verify no marker appears anywhere in what would
be transmitted.

**Acceptance Scenarios**:

1. **Given** a transcript whose message content, tool inputs, tool results, file paths, working
   directory and branch name all carry distinctive marker text, **When** the collector prepares a
   submission, **Then** no marker text appears anywhere in the submitted bytes.
2. **Given** a transcript event carrying fields the collector does not recognise, **When** the
   collector prepares a submission, **Then** those fields are absent from the submission rather
   than passed through.
3. **Given** any submission the collector makes, **When** its fields are enumerated, **Then**
   every one of them is drawn from a fixed, declared set.

---

### User Story 4 - A broken transcript costs one measurement, not the run (Priority: P2)

A session is still being written when the hook fires, so its last line is half a JSON object. A
transcript from a future Claude Code version has a shape this collector has never seen. A file
is unreadable. None of this stops the rest of the usage from being collected and sent.

**Why this priority**: After the first three because it degrades quality rather than breaking
the promise — but it is the difference between a collector that works for a year and one that
stops the first time a format changes underneath it.

**Independent Test**: Run the collector over a directory mixing well-formed transcripts with a
truncated one, an unreadable one, and one whose events have the wrong shape; verify the
well-formed usage is submitted and the run reports success.

**Acceptance Scenarios**:

1. **Given** a transcript whose final line is truncated, **When** the collector runs, **Then**
   the complete lines before it are collected and the truncated line is skipped.
2. **Given** a file that cannot be read, **When** the collector runs, **Then** the other files
   are collected and the run does not raise.
3. **Given** an assistant turn whose usage counters are missing, negative, or not numbers,
   **When** the collector runs, **Then** that turn is skipped and the others are collected.
4. **Given** any of the above, **When** the run finishes, **Then** what was skipped is
   observable to whoever asks for the run's outcome, and is not merely discarded in silence.

---

### User Story 5 - Retained work cannot grow without bound (Priority: P2)

A developer's token expired three months ago and nobody noticed. The collector has been retaining
every session since. Their disk does not fill up, and the collector does not spend a session
close trying to send a hundred thousand stale measurements.

**Why this priority**: After the first three, because it only bites after a long failure — but a
disk-backed retry that has no ceiling is a disk-filling bug waiting for the right outage.

**Independent Test**: Retain more than the configured ceiling; verify the ceiling holds and that
what was discarded is reported.

**Acceptance Scenarios**:

1. **Given** retained work at the configured ceiling, **When** more is retained, **Then** the
   total stays at or below the ceiling and the oldest is discarded first.
2. **Given** work is discarded to hold the ceiling, **When** the run finishes, **Then** the
   discard is reported in the run's outcome, naming how much was discarded.
3. **Given** a submission the service refuses as permanently invalid, **When** the run finishes,
   **Then** that submission is discarded rather than retried forever.

---

### Edge Cases

- **A session resumed after it was already collected.** Claude Code rewrites earlier turns of a
  resumed session into a new transcript. Those turns must be charged once, not twice — across
  runs, across files, and across the boundary between what was already sent and what is on disk
  now (FR-006, FR-007).
- **A turn carrying no identifiers to key on.** If a turn cannot be given a key that is stable
  across runs, sending it would double-count it on the next run. It is skipped and reported
  rather than sent under an invented key (FR-008).
- **Two collector runs at once.** A `SessionEnd` hook fires per session, and a developer may
  close two sessions at the same moment. Neither run may lose the other's retained work, and
  neither may submit the same measurement twice (FR-016).
- **The clock.** `occurredAt` comes from the transcript, which is the client's clock. A transcript
  with no usable timestamp on a turn cannot place that turn in time and is skipped (FR-009).
- **A partially accepted batch.** The service reports accepted, deduplicated and rejected counts.
  A batch that is accepted with some entries rejected has been dealt with — it is not retried,
  and the rejections are reported (FR-021).
- **The service answers with a redirect, an HTML error page, or something that is not the
  documented response.** The collector must treat an unrecognised answer as "not delivered" and
  retain, never as success (FR-020).
- **An empty run.** No transcripts, no new turns, or nothing retained. The run does nothing,
  reports that it did nothing, and succeeds.

## Requirements *(mandatory)*

### Scanning

- **FR-001**: The collector MUST read Claude Code session transcripts from the location Claude
  Code writes them to, discovering them without being told each file, and MUST support the
  per-repository and per-worktree directories Claude Code creates.
- **FR-002**: The collector MUST read transcripts without modifying them in any way.
- **FR-003**: The collector MUST extract usage only from transcript events that represent an
  assistant turn carrying usage counters, and MUST ignore every other event.
- **FR-004**: For each such turn the collector MUST extract exactly: its session identifier, the
  identifiers that key it, the instant it occurred, the model it used, and the five token
  counters (input, output, cache-write-5m, cache-write-1h, cache-read). It MUST extract nothing
  else from the transcript.
- **FR-005**: The collector MUST reproduce the reference implementation's token-bucket
  derivation, including deriving the 5-minute cache-write count from the total cache-creation
  count when it is not reported separately, so that a measurement's counts match what the repo it
  replaces would have recorded for the same turn.

### Keying and deduplication

- **FR-006**: Every submitted measurement MUST carry a key derived only from stable identifiers
  of the turn it represents. The same turn MUST derive the same key on every run, on every
  machine, and regardless of which transcript file it was found in or how many turns preceded it.
- **FR-007**: The collector MUST NOT submit two measurements with the same key within one run,
  even when the same turn appears in more than one transcript.
- **FR-008**: A turn that cannot be given a key satisfying FR-006 MUST be skipped and reported,
  never submitted under a substitute key.
- **FR-009**: A turn with no usable occurrence instant MUST be skipped and reported.

### Submitting

- **FR-010**: The collector MUST submit measurements to the service's documented ingestion
  contract, as a batch that names the agent and carries the measurement entries.
- **FR-011**: The collector MUST authenticate with an ingest token supplied by its caller's
  environment, carried in the `Authorization` header and nowhere else.
- **FR-012**: The collector MUST NOT submit any field the ingestion contract does not define,
  and MUST NOT submit a project or user identity of its own — both are the service's to derive
  from the token.
- **FR-013**: The collector MUST split what it has to send into batches that respect the
  service's documented per-request limits.

### Never blocking, never failing

- **FR-014**: A collector run MUST have a total time budget. When the budget is spent the run
  MUST stop, retain whatever it has not sent, and report success to its caller.
- **FR-015**: A collector run MUST NOT, under any input or any failure, raise to its caller,
  exit non-zero, or write to the agent's error stream in a way the session surfaces as a failure.
  This includes an unreachable service, a refused connection, a hung connection, a service error,
  an unreadable transcript, a malformed transcript, an unwritable retention directory, and a full
  disk.
- **FR-016**: Retention MUST be safe against two collector runs happening at the same time:
  neither run may lose work the other retained, and neither may submit a measurement the other
  already submitted.
- **FR-017**: Everything the collector retains MUST survive the process ending at any point,
  including mid-write. A partially written retained item MUST NOT be submitted and MUST NOT
  prevent the rest from being submitted.

### Retrying and bounds

- **FR-018**: Work not submitted MUST be retained on disk and attempted again by a later run,
  oldest first.
- **FR-019**: Work the service accepted MUST NOT be retained, and MUST NOT be submitted again by
  a later run.
- **FR-020**: The collector MUST treat as "not delivered, retain and retry" any outcome it
  cannot positively recognise as the service's documented success response.
- **FR-021**: The collector MUST honour the service's documented statement of what the client
  should do next: an outcome the service declares permanent MUST be discarded rather than
  retried; an outcome the service declares retryable MUST be retained; an outcome that requires
  new credentials MUST be retained and MUST stop that run's further attempts rather than spending
  the budget failing repeatedly; and a stated wait MUST be respected rather than ignored.
- **FR-022**: Retained work MUST be bounded by a declared ceiling. When the ceiling is reached
  the oldest retained work MUST be discarded first, and the discard MUST be reported.
- **FR-023**: The collector MUST NOT require any local state in order to be correct. Local state
  is permitted only to avoid re-reading transcripts it has already read, and discarding it MUST
  change nothing except how long a run takes.

### Content safety

- **FR-024**: What the collector transmits MUST be constructed from a fixed, declared set of
  fields. A field the collector has not declared MUST NOT reach the wire, including one that
  appears in a future transcript format.
- **FR-025**: The collector MUST NOT transmit anything derived from message content, tool inputs,
  tool results, file contents, file paths, the working directory, the git branch, or the
  transcript's own location on disk.
- **FR-026**: FR-024 and FR-025 MUST be enforced by construction and covered by a test that fails
  if they stop holding — not asserted in documentation alone.
- **FR-027**: The collector MUST NOT write an ingest token, or any part of one, to its output,
  to its retained work, or to any file it creates.

### Reporting

- **FR-028**: A run MUST report its outcome to its caller as data: how much was found, submitted,
  retained, deduplicated, rejected, skipped and discarded, and why anything was skipped or
  discarded. This report is the only channel by which a failure is observable, since FR-015
  forbids every other one.

### Out of scope

Named because each is an adjacent backlog row and building it here would misplace it:

- **Attribution.** No dimension of any type is derived or submitted. Branch-to-dimension rules
  are client-side configuration and belong to T013; T030 then governs omitting or hashing them.
  Nothing in this feature reads a branch name or a directory path for meaning.
- **Declarative configuration.** A repository declaring its endpoint and granularity in a
  committed file is T013. This feature takes its configuration from its caller's environment.
- **Other agents.** opencode and anything else is T014, which is what proves the adapter
  boundary is real.
- **Backfilling the reference repo's history.** The one-shot import of the existing index is
  E09's work, not this.
- **Rendering reports.** The markdown the reference script writes is the dashboard's job now.

### Key Entities

- **Transcript event** — one line of a Claude Code session transcript. Only the assistant turns
  carrying usage counters are of interest, and only six things about them (FR-004).
- **Usage measurement** — the content-free record of one assistant turn: a key, an instant, a
  session identifier, a model, a tier, and five counters. The only thing that leaves the machine.
- **Retained batch** — measurements written to disk because they were not delivered, waiting for
  a later run. Ordered oldest-first, bounded, and removed only once the service has accepted them
  or declared them permanently invalid.
- **Run outcome** — what a run reports to its caller. The whole of the collector's observable
  behaviour, since it may never raise.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With a reachable service, every assistant turn carrying usage in a set of
  transcripts is recorded by the service exactly once, with token counts equal to what the
  reference implementation computes for the same transcripts.
- **SC-002**: Running the collector twice over unchanged transcripts changes no recorded total;
  the second run's measurements are all reported by the service as deduplicated.
- **SC-003**: With the service unreachable, refusing, hanging, or returning any error, the run
  always reports success to its caller and never raises — for every failure mode enumerated in
  FR-015.
- **SC-004**: A run's wall-clock duration never exceeds its configured time budget by more than
  the time to finish one in-flight request, regardless of how much is retained or how the service
  misbehaves.
- **SC-005**: For a transcript in which every content-bearing field carries a distinctive marker,
  the bytes the collector would transmit contain no marker.
- **SC-006**: A directory mixing valid, truncated, unreadable and structurally unfamiliar
  transcripts yields every valid measurement, and the run's outcome names each thing skipped.
- **SC-007**: Retained work never exceeds its declared ceiling, however many runs fail
  consecutively.
- **SC-008**: The collector's unit tests cover at least 80% of its lines, statements, functions
  and branches — the threshold this package declares (Constitution, Principle VII).

## Assumptions

- Claude Code writes session transcripts as JSONL under a per-user directory, one directory per
  project path, with the shape documented in `docs/00-architecture-proposal.md` §1.2. That shape
  is treated as observed reality, not a contract: FR-003 and US4 exist because it can change.
- The ingestion contract this collector targets is the one deployed on the main branch
  (`apps/api/src/routes/ingest.route.ts`, `specs/0011-ingestion-endpoint/`,
  `specs/0013-ingest-tokens/`, `specs/0017-ingestion-rate-limiting/`). This feature consumes it
  and does not change it. If it turns out to need changing, that is a separate task.
- The service is the authority on price. This feature transmits counters and a declared tier; it
  computes no cost and carries no price table.
- A developer wiring this into a `SessionEnd` hook is the primary caller. The collector is also
  usable as a library, because the hook entry point has to be a thin wrapper over something
  testable.
- The endpoint and the ingest token reach the collector as environment values and are never
  committed anywhere (Constitution, Environment Configuration).
