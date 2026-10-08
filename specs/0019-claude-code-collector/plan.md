# Implementation Plan: Claude Code collector

**Branch**: `0019-claude-code-collector` | **Date**: 2026-08-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/0019-claude-code-collector/spec.md`

## Summary

Turn `packages/collector` from a placeholder into the piece that runs on a developer's machine:
read Claude Code's own session transcripts, project each assistant turn into the service's
ingestion contract, retain what could not be delivered on disk, and send it — under a wall-clock
budget, never raising, never exiting non-zero, and never transmitting anything derived from
message content.

The shape follows from three constraints that pull against each other. *Never obstruct* forces a
time budget and a disk queue. *Idempotent replay* forces a key that is final the moment it is
written, which is the assistant message id (research.md Decision 1) — not a session bucket, whose
counts keep growing. *Send metrics, never content* forces the outbound payload to be built by an
allowlist projection rather than filtered down from a transcript object (Decision 5), because the
transcript events carry `cwd`, `gitBranch` and the full text of every prompt and file the agent
read.

Nothing here derives an attribution dimension. That is T013's subject, and building it here would
mean reading exactly the fields this feature exists to keep off the wire.

## Technical Context

**Language/Version**: TypeScript 5.9 on Node 22 (the workspace's `engines.node` floor), ESM,
`NodeNext` resolution, `strict`.

**Primary Dependencies**: none. `node:fs`, `node:fs/promises`, `node:path`, `node:os`,
`node:readline`, and the global `fetch`/`AbortSignal` Node 22 provides (research.md Decision 10).

**Storage**: the developer's filesystem only — a queue directory and a cursor file under
`${XDG_CACHE_HOME:-$HOME/.cache}/agentmeter/`. No database; this package never talks to one.

**Testing**: Vitest, `*.unit.test.ts`, every injected dependency mocked, no network and no real
`~/.claude` — transcripts are written into a temporary directory per test. `packages/collector`
declares an 80% threshold on lines, statements, functions and branches, already present in
`vitest.unit.config.ts` and not lowered.

**Target Platform**: a developer's machine, invoked from a Claude Code `SessionEnd` hook. Also
importable as a library.

**Project Type**: library plus a thin binary (research.md Decision 11).

**Performance Goals**: a run finishes inside its time budget — 5 s by default, 2 s per request —
and a run over unchanged transcripts does no parsing work at all (Decision 8's cursor).

**Constraints**: never raises, never exits non-zero, never writes to a stream the session
surfaces as failure; transmits only the fields named in the ingestion contract; retains a bounded
amount on disk.

**Scale/Scope**: measured against real transcripts — 24 project directories, 17 591 assistant
turns with usage in the 60 files sampled, 8 667 distinct measurements. A heavy user produces a
few thousand new turns a day.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Verdict |
| --- | --- |
| **I. Domain Scope Boundary** — does the server stay ignorant of what any dimension *means*? Is all dimension-derivation logic client-side? | **PASS.** No server change of any kind. This feature submits no dimension at all (research.md Decision 12), so it cannot teach the server a vocabulary. Branch-to-dimension rules stay client-side by construction, in T013. |
| **II. Immutable Facts, Mutable Labels** — are measured tokens never rewritten? Do label changes go through a recorded revision? | **PASS.** The collector only ever submits; it has no path that rewrites an accepted measurement, and the ledger refuses one by design. The consequence — a turn first read in a partial state cannot be corrected later — is stated in research.md Decision 2 rather than worked around by a rewrite. |
| **III. Idempotent Ingestion** — is every ingest path a no-op on replay? Is client-side state purely an optimisation? | **PASS.** The key is intrinsic to the turn and identical on every run and machine (Decision 1). The cursor is an optimisation whose deletion changes only run duration (Decision 8), and FR-023 plus its test say so. |
| **IV. Client Never Obstructs** — short timeout, disk queue on failure, malformed payload swallowed? (collector changes only) | **PASS.** 2 s per request and a 5 s run budget, both configurable; every undelivered batch retained on disk; every failure — unreachable, hung, 5xx, unreadable file, truncated JSON, unwritable queue — absorbed into the run outcome (FR-015). This is the gate the whole design is arranged around. |
| **V. Simplicity & YAGNI** — is every abstraction demanded by a present requirement? | **PASS.** Eight modules, each traceable to a requirement group in spec.md; no plugin layer, no adapter registry, no configuration file format. The one thing that could look speculative — the transport being an injected function rather than a direct `fetch` call — exists so the never-raises property can be tested against a service that hangs, which is untestable otherwise. A second agent adapter is explicitly deferred to T014 rather than anticipated with an abstraction here. |
| **VI. Persistence Agnosticism** — is business logic testable without a database? | **PASS.** This package has no database code and no database test. Its own persistence — the queue — is behind one module and injected into the run, so the run is testable against an in-memory stand-in. |
| **VII. Testing Discipline** — coverage threshold declared and not lowered? Repository tests against real TimescaleDB? | **PASS.** 80% on all four metrics, already declared in `packages/collector/vitest.unit.config.ts`, unchanged. `coverage.include` stays `src/**/*.ts`, so every file this feature adds is counted; the single exclusion is the shebang bootstrap, which Principle VII forbids testing. No repository and no database, so the TimescaleDB clause does not apply. |
| **API** — every endpoint under `/api/v1`, fully documented, and covered by the OpenAPI quality-gate test? | **n/a.** No endpoint is added, changed or removed. The collector consumes the deployed contract and treats it as authoritative. |
| **Auth** — tokens in headers only, acting user derived server-side, role filtering in the query layer? | **PASS.** The ingest token is read from the environment and placed in `Authorization: Bearer` and nowhere else — never a URL, never the body, never a log line, never a retained file (FR-011, FR-027). The collector submits no project or user identity; both are the service's to derive (FR-012). |
| **Data Layer** — hypertables/policies/aggregates declared in versioned migrations? Ingestion in one transaction? | **n/a.** No migration and no database object. This feature adds nothing to `apps/api`. |
| **Verification data** — does every cross-account aggregate exclude verification accounts? (any spec that aggregates) | **n/a.** Nothing here aggregates across accounts; the collector sees exactly one project's credential and computes no totals. |
| **Environment values** — is every domain, host, URL, port and resource id absent from committed files, tests and docs included? | **PASS.** The endpoint and the token are environment values read through `resolveConfigFromEnv`. No committed file — source, test, fixture, README or spec — carries a host, port, database name, user or password. Tests use `https://collector.invalid` (the reserved TLD, guaranteed never to resolve) and a stand-in transport that makes no connection. |
| **Logging** — no credential, query string or user attribute loggable? Redaction enforced at the logging surface? | **PASS with a scoped justification.** `apps/api/src/logging` is the API's surface and this package cannot import it — it runs on a developer's machine with no pino and no dependencies. The collector therefore does not log at all: it returns a `RunOutcome` (FR-028) and the CLI prints it. That outcome is built from a closed set of fields carrying counts and reason codes, so there is no call site at which a credential or a content value could be written. FR-027 is the tested form of the rule. |
| **Frontend** — patterns before features, WCAG 2.1 AA met, URLs and text centralised? (dashboard changes only) | **n/a.** No dashboard change. This is not a UI spec: it introduces no view, no component and no user-visible copy beyond a CLI summary line. |

No row is a blocking violation, so Complexity Tracking below is empty.

## Project Structure

### Documentation (this feature)

```text
specs/0019-claude-code-collector/
├── spec.md
├── research.md
├── plan.md              # This file
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── ingest-submission.md     # what the collector sends, and what it does with each answer
│   └── run-outcome.md           # the only channel by which a failure is observable
└── tasks.md
```

### Source Code (repository root)

```text
packages/collector/
├── package.json                 # + build script, + bin, unchanged deps (none added)
├── tsconfig.json
├── tsconfig.build.json          # new — emits dist/ for the bin, same pattern as apps/api
├── vitest.unit.config.ts        # unchanged thresholds; one bootstrap exclusion
├── README.md                    # public documentation: env vars, commands, hook wiring
├── src/
│   ├── index.ts                 # the package's public surface
│   ├── config/
│   │   └── collector-config.ts  # typed config + resolveConfigFromEnv
│   ├── claude-code/
│   │   ├── transcript-locations.ts   # where transcripts live, which files to read
│   │   ├── transcript-reader.ts      # whole lines only, from an offset
│   │   └── usage-extraction.ts       # transcript line -> UsageTurn | skip reason
│   ├── contract/
│   │   ├── ingest-contract.ts        # wire types, agent name, batch splitting
│   │   └── measurement-projection.ts # UsageTurn -> MeasurementEntry (the allowlist)
│   ├── queue/
│   │   ├── queue-paths.ts            # cache-dir resolution
│   │   └── batch-queue.ts            # atomic enqueue, oldest-first drain, ceiling
│   ├── cursor/
│   │   └── scan-cursor.ts            # optimisation only; deleting it changes nothing
│   ├── transport/
│   │   └── ingest-transport.ts       # fetch + timeout -> a classified delivery outcome
│   ├── run/
│   │   ├── run-outcome.ts            # the outcome type and its accumulation
│   │   ├── collect.ts                # scan -> project -> enqueue
│   │   └── run-collector.ts          # the never-rejecting entry point: collect then drain
│   └── cli/
│       ├── run-cli.ts                # argv + io in, exit code out; always 0
│       └── agentmeter.ts             # shebang bootstrap; no logic; not tested
└── test/unit/                        # one *.unit.test.ts per module above
```

**Structure Decision**: everything lands inside `packages/collector`, which exists precisely for
this and carries no product logic today. Nothing outside it is modified: `apps/api` is read-only
for this feature by instruction and by need, the root scripts already discover the package
through `pnpm -r`, and `TODO.md`'s row is marked at the end of the pipeline.

The internal grouping is by responsibility rather than by layer, because the responsibilities are
what the requirements are grouped by: reading Claude Code's format is one concern that a second
adapter (T014) will sit beside; the wire contract is a second; retaining and delivering is a
third; and the run that composes them is the fourth and the only one that must never raise.

## Approach, in the order the code runs

1. **Resolve configuration** from the environment: endpoint, token, tier, budgets, ceilings. A
   missing endpoint or token is not a crash — it is a run that reports "not configured", collects
   nothing and returns success, because a hook fires in repositories that never opted in.
2. **Scan.** List transcript files under the transcripts root; skip any whose size and mtime match
   the cursor; read the rest from the recorded offset, whole lines only. Each line that parses,
   is an assistant turn, and carries usage becomes a `UsageTurn` — or a skip with a reason.
3. **Project and deduplicate.** Each turn becomes a `MeasurementEntry` through the allowlist
   projection. Within the run, entries sharing a key collapse to the one with the greatest token
   total (research.md Decision 2).
4. **Enqueue, then advance the cursor.** Split into batches, write each atomically, enforce the
   ceiling, and only then record the offsets — so a crash costs a redundant send, never a lost one.
5. **Drain.** Oldest batch first, until the queue is empty, the budget is spent, or the service
   says stop. Each answer is classified and acted on per `contracts/ingest-submission.md`.
6. **Report.** Return the accumulated outcome. The CLI prints one line and exits 0.

Steps 2–5 each run inside the same guard: a failure anywhere is recorded in the outcome and the
run continues with what it can still do.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None. Every Constitution Check row is PASS or `n/a`, and the one row carrying a justification
(Logging) is justified in place rather than deferred here.
