# C005 — autopilot decisions

Decisions the orchestrator took on the human's behalf while this task ran in an autopilot lane
(run 20261009-1, extended with this task: the owner allowed tasks that arise from the run to be
queued). Each is recorded before it is given to the lane. The branch starts from C001's unmerged
branch.

## scope gate

Reviewed: `docs/chores/C005-check-the-collector-s-contract-against-t.md` at `d366eb4`, the range
`origin/C001-adopt-taskrail-with-a-backlog-of-the-col..d366eb4` (the artifact and its index row,
nothing else). Checked by the orchestrator: the SHA-256 of the service's document on its task
branch is the one the lane reports, and every value in it was read at that task's own gate —
field names, statuses and invented examples. The scope stage has no configured checks.

| # | Question | Options | Decision | Reason |
|---|---|---|---|---|
| 1 | How does the provenance record name its source while the service's task is unmerged? | `version` and `sha256` bind, source commit `null` until it exists on the service's `main` · record the branch commit · wait for the merge | as recommended: **content-addressed, commit filled later** | The service squash-merges, so the branch commit will never exist on its `main`; the hash is true before and after. |
| 2 | Does the test hold the copy to the recorded SHA-256? | yes · recorded for humans only | as recommended: **yes** | Editing the document to make the test pass becomes a visible two-file change. |
| 3 | Does the test also assert the request as the transport sends it? | yes · only the listed assertions | as recommended: **yes** | The document pins the method and the headers, and nothing else here would fail on a renamed header. |
| 4 | Where is the refresh procedure written? | `CLAUDE.md` and the test's header · a README beside the copy | as recommended: **`CLAUDE.md` and the test's header** | Rule 4's paragraph is where the contract's authority is already stated. Flagged to the owner at hand-off, as every edit of that file is. |
| 5 | Is the document's `description`, which names two file paths of the service's repository, published as is? | yes, byte for byte · reworded by the service first | as recommended: **yes** | Paths under `apps/api/` are already in this repository's public comments and design record; altering the copy would break the hash. |
| 6 | Which comments are repointed? | the two blocks that name the three service files · also the `INGEST_PATH` comment | as recommended: **the two blocks** | The other references name no file of the service. |

For the owner, outside this task: the lane noticed that the example request in
`specs/0019-claude-code-collector/contracts/ingest-submission.md`, already public, carries an
`idempotencyKey` and a `sessionId` that do not look like placeholders. It is a governing path and
was not touched.

## implement gate

Reviewed: the range `e849d7c..56842d4` — the copied document (its SHA-256 recomputed by the
orchestrator and equal to the recorded one), the provenance record, the new unit test as the lane
reported it (24 tests), and the diff of `src/contract/ingest-contract.ts`, comments only. Broken on
purpose by the orchestrator in the lane's worktree: a token field renamed in
`measurement-projection.ts` — the contract test failed — then restored, tree clean. Re-run:
`taskrail checks C005` — `test` and `lint` passed; `taskrail validate` — 5 tasks, 0 errors. The
lane showed each assertion failing under a deliberate change to the collector and, separately, to
the copy and its record. The collector departs from the document nowhere.

| # | Question | Options | Decision | Reason |
|---|---|---|---|---|
| 1 | Is the implement stage approved? | approve · amend | **approve** | The collector is held to the copy, the copy to its recorded hash, and nothing that ships changed: the package is the same 39 files. |

## close

Reviewed: the range `cf3f206..16a5237` — the three approved edits of `CLAUDE.md` (rule 4, the
layout row, the refresh procedure), a note in the artifact, and the status change committed on its
own (`16a5237`). Re-run by the orchestrator: `taskrail checks C005` — `test` and `lint` passed;
`taskrail validate` — 0 errors. The branch has no upstream. `taskrail review` reported no rebase
needed onto C001's branch.

| # | Question | Options | Decision | Reason |
|---|---|---|---|---|
| 1 | Is the close approved? | approve · hold | **approve** | The collector is held to the service's pinned document by a test seen failing on every departure tried. |
| 2 | Which pull request title? | the generated one · `test(C005:contract): hold the collector to a copy of the service's pinned contract document` | **the lane's** | It releases nothing: a fixture, a test, comments and documentation. |
| 3 | When is the branch published? | after C001's pull request is merged · now | **after C001's** | One branch is in review at a time; it then rebases onto `main`. |

For the owner: `source.commit` in the provenance record is `null` until the service's task T153 is
on its `main`; filling it is a one-line edit that changes neither the copy nor its hash.
