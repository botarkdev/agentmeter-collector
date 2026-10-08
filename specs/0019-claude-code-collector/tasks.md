---
description: "Task list for 0019-claude-code-collector"
---

# Tasks: Claude Code collector

**Input**: Design documents from `/specs/0019-claude-code-collector/`

**Prerequisites**: spec.md, plan.md, research.md, data-model.md, contracts/

**Tests**: MANDATORY (Constitution, Principle VII). Every task below that adds a module adds its
`*.unit.test.ts` in the same task — a module and its test are one unit of work, not two, because
splitting them is how a module arrives untested and nobody notices.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: touches files no other unstarted task touches, so it can run in parallel.
- **[Story]**: the user story from spec.md it serves.

All paths are relative to `packages/collector/`.

---

## Phase 1: Package setup

**Purpose**: make the package able to hold this feature, before any of it is written.

- [ ] **T001** Add `tsconfig.build.json` emitting to `dist/` (the pattern `apps/api` already
  uses), and add `"build": "tsc -p tsconfig.build.json"` plus the `bin` entry to
  `package.json`. No dependency is added — the package stays at zero runtime dependencies
  (research.md Decision 10).
- [ ] **T002** In `vitest.unit.config.ts`, exclude only `src/cli/agentmeter.ts` from coverage
  (bootstrap; Principle VII forbids testing it). `coverage.include` stays `src/**/*.ts` and the
  four 80% thresholds stay exactly as they are — they are a ratchet.
- [ ] **T003** Add `test/unit/support/transcripts.ts`: helpers that write a temporary transcript
  directory from declarative fixtures, and a `markerTranscript()` builder whose every
  content-bearing field carries a distinctive marker (used by US3). No test asserts anything
  here; this is scaffolding the tests depend on.

---

## Phase 2: US3 — nothing derived from content leaves the machine (P1)

**Why first**: it is the only requirement in this feature whose violation cannot be undone, and
it constrains the shape of every module downstream. Building it last would mean retrofitting the
boundary rather than designing to it.

- [ ] **T004** [US3] `src/claude-code/usage-extraction.ts` + test. A parsed transcript line in,
  a `UsageTurn` or a `SkipReason` out (data-model.md). Implements research.md Decision 4's bucket
  derivation including the `cache_creation_input_tokens` fallback, Decision 3's zero-token skip,
  and the missing-key / missing-timestamp / missing-model / invalid-counts skips. Never throws.
  Tests must cover: each skip reason individually; the itemised buckets winning over the flat
  count; the fallback path when `cache_creation` is absent; a counter that is a string, negative,
  or fractional.
- [ ] **T005** [US3] `src/contract/measurement-projection.ts` + test. `UsageTurn` + tier →
  `MeasurementEntry`, built field by field from named arguments, never by spreading an object
  (research.md Decision 5). `sessionId` is omitted rather than sent empty or null.
- [ ] **T006** [US3] The content-safety test, in
  `test/unit/contract/content-safety.unit.test.ts`. Build a transcript event in which message
  content, tool input, tool result, `cwd`, `gitBranch`, `slug`, `entrypoint`, `error`, `uuid`
  and several fields invented for the test all carry distinct marker strings; extract, project,
  serialise the batch to JSON; assert **no marker appears in the serialised bytes**, and assert
  the entry's key set equals the exact allowlist. This is FR-026 and it must be able to fail:
  observe it fail by adding a field to the projection before removing it again.

---

## Phase 3: US1 — usage arrives with no action from the developer (P1)

- [ ] **T007** [P] [US1] `src/config/collector-config.ts` + test. Defaults, `not-configured` when
  endpoint or token is absent, a bad numeric variable falling back to its default and recording a
  `config` failure. Test that the token never appears in the returned structure's string
  rendering.
- [ ] **T008** [P] [US1] `src/claude-code/transcript-locations.ts` + test. Resolve the
  transcripts root, list `.jsonl` files recursively including per-worktree directories, tolerate a
  missing root by returning nothing, tolerate an unreadable subdirectory by skipping it.
- [ ] **T009** [P] [US1] `src/claude-code/transcript-reader.ts` + test. Read a file from a byte
  offset, yield **whole lines only**, report the offset reached and the count of unparsable lines.
  A trailing partial line is not yielded and not included in the offset (US4, FR-017). One test
  asserts the transcript's bytes and mtime are unchanged after a read — FR-002 is a promise about
  someone else's data and deserves a test rather than an assumption.
- [ ] **T010** [US1] `src/contract/ingest-contract.ts` + test. The wire types, the `claude-code`
  agent constant, the ingest path, and batch splitting at `maxBatchSize`. Test that no batch is
  empty and that splitting preserves every entry exactly once, for sizes on both sides of the
  boundary.
- [ ] **T011** [US1] `src/run/collect.ts` + test. Scan → extract → project → deduplicate. The
  deduplication is research.md Decision 2: same key collapses to the greatest token total, tie
  keeps the first, and the result does not depend on file order — test it by feeding the same two
  occurrences in both orders and asserting the same outcome, not by asserting which one "won".
- [ ] **T012** [US1] `src/transport/ingest-transport.ts` + test. `fetch` with an
  `AbortSignal.timeout`, `Authorization: Bearer`, and classification of every row of
  contracts/ingest-submission.md into a delivery outcome. Injected `fetch` in tests; no network.
  Test the 200-with-wrong-body case explicitly — it is the one that silently looks like success.

---

## Phase 4: US2 — the service is unreachable and nothing is lost (P1)

- [ ] **T013** [P] [US2] `src/queue/queue-paths.ts` + test. Cache directory resolution honouring
  `AGENTMETER_CACHE_DIR` then `XDG_CACHE_HOME` then the home fallback.
- [ ] **T014** [US2] `src/queue/batch-queue.ts` + test. Enqueue via write-then-rename, list
  oldest-first, remove, and enforce the ceiling that T021 tests. Tests: a `.tmp` file is never
  listed; a file whose content is not valid JSON is removed and reported rather than blocking the
  drain; two enqueues in the same millisecond both survive (FR-016); an unwritable directory
  produces a failure record rather than a throw; and a queued file's bytes contain no token even
  when one is configured (FR-027 — the queue is the one place a credential could plausibly be
  written to a developer's disk).
- [ ] **T015** [US2] `src/run/run-outcome.ts` + test. The outcome type and its accumulation:
  merging skip counts, appending failures, and the invariant that counts are numbers rather than
  optionals.
- [ ] **T016** [US2] `src/run/run-collector.ts` + test — the never-rejecting entry point.
  Collect, enqueue, then drain oldest-first under the run budget. Tests: unreachable, hung,
  5xx, 429, 401, permanent rejection, unwritable queue, unreadable transcript, and a transcript
  directory that does not exist — each asserting the run resolves with an outcome and never
  rejects. Assert **invariants, not timing**: that the budget is respected is asserted through an
  injected clock, never by measuring wall-clock duration or counting how many attempts happened.
- [ ] **T017** [US2] Queue-survives-and-delivers test: a first run against a transport that always
  fails leaves N batches queued; a second run against an accepting transport delivers exactly
  those batches, oldest first, and leaves the queue empty (FR-018, FR-019).

---

## Phase 5: US4 and US5 — degradation and bounds (P2)

- [ ] **T018** [US4] `src/cursor/scan-cursor.ts` + test. Read, write, treat missing/unparsable/
  unknown-version as empty, drop entries for files that no longer exist, and re-read from zero
  when size or mtime no longer match.
- [ ] **T019** [US4] Wire the cursor into `run-collector.ts`: enqueue **before** advancing it
  (research.md Decision 8). Test that a failure between the two re-reads and re-enqueues rather
  than losing the turns, and that deleting the cursor changes only how much is re-read — never
  which measurements are produced (FR-023).
- [ ] **T020** [US4] Mixed-directory test: valid, truncated-tail, unreadable, and structurally
  unfamiliar transcripts in one directory. Every valid measurement is produced, and every skip
  appears in `outcome.skipped` with its reason (US4 acceptance 4).
- [ ] **T021** [US5] Ceiling test: enqueue past `maxQueuedBatches`, assert the count holds, that
  the *oldest* were the ones discarded, and that `queue.discarded` reports how many.
- [ ] **T022** [US5] Permanent-rejection test: a `DO_NOT_RETRY` / `FIX_AND_RETRY` answer removes
  the batch and records it, rather than retaining it forever (FR-021).

---

## Phase 6: entry point and documentation

- [ ] **T023** `src/cli/run-cli.ts` + test. argv and io injected; prints one summary line built
  only from counts and codes; returns 0 for every outcome including `not-configured` and every
  failure. Test that the printed line contains no token even when one is configured.
- [ ] **T024** `src/cli/agentmeter.ts` — shebang bootstrap, no logic, not tested (Principle VII).
- [ ] **T025** `src/index.ts` — the public surface: `runCollector`, `resolveConfigFromEnv`, and
  the types a caller needs. Nothing internal is re-exported.
- [ ] **T026** Rewrite `packages/collector/README.md`: what the package is, the environment
  variables (names and meanings only, never values), the commands, and how to wire the
  `SessionEnd` hook. Constitution, Documentation: this is a package's public documentation and it
  must land in the same commit as the contract it describes.
- [ ] **T027** Update the root `CLAUDE.md` project-status paragraph so it stops saying the
  collector is a placeholder.

---

## Phase 7: verification

- [ ] **T028** `pnpm run typecheck`, `pnpm test:all` and `pnpm run test:cov` from the repository
  root, each with its exit code captured directly. The coverage gate is the one that has failed a
  task in CI after being reported green: confirm the new files actually appear in the report
  rather than trusting the percentage.
- [ ] **T029** Grep the whole diff for values that must never be committed — hosts, ports,
  database names, users, passwords, tokens — and for any leftover marker string from the
  content-safety fixtures.

---

## Dependencies

- Phase 1 blocks everything.
- Phase 2 (T004–T006) blocks Phase 3, because the projection is what Phase 3 batches and sends.
- T010 blocks T012 and T014 (both need the wire type).
- T015 blocks T016. T014 blocks T016, T017 and T021. T012 blocks T016.
- T018 blocks T019.
- Phase 6 depends on T016 and T023 existing; T026 depends on the final configuration surface.
- Phase 7 runs last, over everything.

## Parallelisable

`[P]` tasks touch disjoint files: T007, T008, T009 in Phase 3, and T013 in Phase 4.

## Out of scope, deliberately

Named so their absence reads as a decision rather than an omission — each is another backlog row
(spec.md, "Out of scope"): attribution dimensions (T013), a declarative configuration file
(T013), a second agent adapter (T014), backfilling the reference repo's history (E09), and any
report rendering (E08).
