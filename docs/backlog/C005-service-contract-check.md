# C005 — Check the collector's contract against the service's pinned document

Detail for `TASKRAIL.md` row C005. It was written where the other half of the work was done: in
the service's repository, `botarkdev/agentmeter` (private), by the task that pinned the contract
there.

## Why

The collector lived in the service's repository until 2026-10-08, and a change to
`POST /api/v1/ingest` that broke it failed in the same pull request. It no longer does. The
service now pins, in one document of its own, the request and response shapes this collector
relies on, and a test there fails when the endpoint departs from it. This task is the collector's
half: a test here that fails when the collector departs from the same document.

The service remains the authority on the contract (`CLAUDE.md`, rule 4). The copy held here is
evidence of what the collector was checked against, never a second definition.

## What

- Copy `apps/api/contracts/collector-ingest.json` from `botarkdev/agentmeter` into
  `test/fixtures/collector-ingest.contract.json`, and record beside it the source commit, the
  document's `version` and the file's SHA-256.
- Add `test/unit/contract/service-contract.unit.test.ts`, which reads the copy and asserts:
  - `INGEST_PATH` equals `request.path`;
  - `MEASUREMENT_ENTRY_FIELDS` equals `measurementFields.always` plus `whenKnown`, and
    `TOKEN_FIELDS` equals `tokenFields`;
  - `projectMeasurement` over a turn with and without a session id produces the two example
    entries' key sets;
  - `splitIntoBatches` produces a batch whose keys are `batchFields`;
  - `CLIENT_ACTIONS` equals `refused.actions`;
  - `readAcceptance` of `accepted.example` returns its three counts;
  - `HttpIngestTransport` classifies each `refused` case as
    `specs/0019-claude-code-collector/contracts/ingest-submission.md` says.
- Repoint the three comments in `src/contract/ingest-contract.ts` that name the service's files
  at the document.

## Limits

- No runtime dependency is added, and nothing is read over the network: the test reads the
  committed copy.
- Refreshing the copy is a manual step, done when the service raises the document's `version`.
  The service's repository is private, so the copy is the only form of the document a reader of
  this repository can see. This repository is public: before the copy is committed, check that it
  holds shapes and invented example values and nothing else.
- The design record under `specs/0019-claude-code-collector/` is not edited.
