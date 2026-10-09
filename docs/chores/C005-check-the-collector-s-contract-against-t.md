# C005 — Check the collector's contract against the service's pinned document

## Goal

Until 2026-10-08 the collector lived in the service's repository, and a change to
`POST /api/v1/ingest` that broke it failed in the same pull request. It no longer does. The
service now pins what this collector relies on in one document of its own,
`apps/api/contracts/collector-ingest.json` of `botarkdev/agentmeter` (private), and a test there
holds the endpoint to it. This task is the collector's half: a byte-for-byte copy of that document
committed here, a record of where it came from, and a unit test that fails when the collector's
wire shape, batching, reading of the accepted answer or classification of a refusal departs from
it.

The service stays the authority (`CLAUDE.md`, rule 4). The copy is evidence of what the collector
was checked against, never a second definition: the test reads it, and nothing under `src/` does.

## What was found

- **The document**, read from the service's task branch (its task T153, not merged yet): 81
  lines, `"contract": "collector-ingest"`, `"version": 1`, SHA-256
  `4cf2bfb6bb0b925b92cdc7c24cf5107eaf0f67e2cfb9653886eae0548479489d` — verified against the bytes
  git holds.
- **Every value in it was checked for publication.** It holds: field names; HTTP statuses; the
  four action names; the path `/api/v1/ingest`; the header value `Bearer <ingest token>` (a
  literal placeholder in angle brackets); two example bodies whose identifiers are
  `msg_placeholder_with_session`, `msg_placeholder_without_session` and the session id
  `00000000-0000-4000-8000-000000000001`; the model name `claude-opus-5` and tier `standard`
  (both already in this repository's tests); two instants and ten token counts, which are the
  ones this repository's own design record already publishes as its example
  (`specs/0019-claude-code-collector/contracts/ingest-submission.md`); a cost of `"0.000000"`;
  `consumer`, which names this repository, its release `v0.2.0` and the commit that tag points
  at, `133b3217bb9a20403f21ce95c8ac06b9eb3474b1` — public facts about this repository; and a
  `description` that names two files of the service's repository by path
  (`apps/api/test/unit/collector-ingest-contract.unit.test.ts`, `apps/api/README.md`). Paths
  under `apps/api/` are already named in this repository's comments and design record. **No
  hostname, no token, no address, no person, no transcript content, no machine path. Nothing in
  it needs to be withheld.**
- **Prettier accepts the document unchanged** under this repository's configuration
  (`prettier --check` on a temporary copy: "All matched files use Prettier code style!"), so
  `pnpm format:check` passes on the byte-for-byte copy and `.prettierignore` needs no entry. If a
  later version of the document is not in Prettier's style, the refresh adds the entry; `pnpm
  format` rewriting the copy would in any case fail the SHA-256 assertion below.
- **`test/` is never packed**: `scripts/check-package.mjs` already forbids `package/test/`. The
  published package stays the same set of files.
- **The comments to repoint.** `src/contract/ingest-contract.ts` names three files of the
  service's repository, in two comment blocks: `apps/api/src/routes/ingest.route.ts` and
  `apps/api/src/dto/ingest-request.schema.ts` in the file's header, and
  `apps/api/src/errors/client-action.ts` above `CLIENT_ACTIONS`.

## Change set

| File | Change |
| --- | --- |
| `test/fixtures/collector-ingest.contract.json` | New. The service's document, byte for byte. The path is the one the backlog detail names. |
| `test/fixtures/collector-ingest.contract.provenance.json` | New. The provenance record, read by the test: see "The provenance record". |
| `test/unit/contract/service-contract.unit.test.ts` | New. Reads the two files above with `node:fs` and asserts what "The assertions" lists. No network, no new dependency. |
| `src/contract/ingest-contract.ts` | Comments only, two blocks, three file names: see "The comments". No code changes; the compiled output differs in comments only. |
| `CLAUDE.md` | Rule 4 gains how the contract is held (the copy, the test, "never edit the copy to make the test pass"); the layout table gains a `test/fixtures/` row; a short "Refreshing the contract copy" procedure. Done in the docs stage. |
| `docs/chores/C005-check-the-collector-s-contract-against-t.md`, `docs/chores/README.md` | This document and its index row. |
| `TASKRAIL.md` | Row C005, by `taskrail done` only. |

Not changed: any code under `src/`, any existing test, `package.json`, `pnpm-lock.yaml`,
`.prettierignore`, `scripts/`, both workflows, `README.md` (it describes the contract types as
part of the public surface and says nothing about how the contract is held), `CHANGELOG.md`
(nothing that ships changes), `LICENSE`, `specs/`.

### The provenance record

```json
{
  "document": "collector-ingest.contract.json",
  "source": {
    "repository": "botarkdev/agentmeter",
    "path": "apps/api/contracts/collector-ingest.json",
    "addedBy": "T153",
    "commit": null
  },
  "version": 1,
  "sha256": "4cf2bfb6bb0b925b92cdc7c24cf5107eaf0f67e2cfb9653886eae0548479489d",
  "copiedOn": "<the UTC date of the copy>"
}
```

- **`version` and `sha256` are the binding identity.** They name the content, so they are true
  before and after the service merges T153, and anyone with access to the service's repository
  can verify the copy against any commit that holds the document with one `sha256sum`.
- **`source.commit` is `null` until T153 is on the service's `main`.** The service squash-merges,
  so the commit the document was read from (on T153's unmerged branch) will not exist on its
  `main`; recording it would publish an identifier nobody can resolve. It is filled by hand, with
  the squash commit, once that exists — a one-line edit that changes neither the copy nor the
  SHA-256.
- A JSON file rather than Markdown, so the test reads it and the record cannot go stale beside a
  test that passes.

### The assertions

Every expected name and value comes from the document; the test file holds no field name, path,
status or action of its own. The one thing it does hold is what the collector does with each
refusal (kept or discarded, whether the run stops), which the document does not say and
`specs/0019-claude-code-collector/contracts/ingest-submission.md` does.

1. **The copy is the recorded one**: the SHA-256 of the copy's bytes equals `sha256`; the
   document's `version` equals `version`; its `contract` is `collector-ingest`; `source.commit`
   is `null` or forty hexadecimal characters.
2. **Path**: `INGEST_PATH` equals `request.path`.
3. **Field lists**: `MEASUREMENT_ENTRY_FIELDS` equals `measurementFields.always` plus
   `whenKnown`, and `TOKEN_FIELDS` equals `tokenFields` — as sets, both directions, since the
   collector's order differs from the document's and order means nothing on the wire.
4. **Projection**: for each of `request.examples`, a turn built from the example's entry is put
   through `projectMeasurement`; the result's key set equals the example entry's key set, its
   `tokens` key set equals the example's, and the result deep-equals the example entry. The two
   examples are the turn with a session id and the turn without one; the test also asserts that
   the examples between them cover "every `whenKnown` field present" and "none present", so a
   refreshed document cannot quietly drop one of the two.
5. **Batching**: `splitIntoBatches(example.agent, entries, 1)` yields batches whose keys equal
   `batchFields`, and `CLAUDE_CODE_AGENT` equals the examples' `agent`.
6. **The request on the wire**: `HttpIngestTransport.deliver` of an example batch, over an
   injected `fetch`, calls `<endpoint>` + `request.path` with `request.method`, header names equal
   to the keys of `request.headers`, `content-type` equal to the document's value,
   `authorization` equal to the document's value with its `<ingest token>` placeholder replaced
   by the test's placeholder token, and a body that parses back to the example. *This one is not
   in the backlog detail's list; see decision 3.*
7. **Actions**: `CLIENT_ACTIONS` equals `refused.actions`, as sets.
8. **Refusal body**: `readServiceError` of a body holding each of `refused.bodyFields` returns
   exactly those keys.
9. **Accepted answer**: `readAcceptance(accepted.example)` returns exactly the
   `accepted.integerFields` keys with the example's three counts; the example with any one of
   those fields replaced by a string is not an acceptance; and the transport, answered
   `accepted.status` with the example, reports `accepted` with the same counts.
10. **Refusals**: for each of `refused.cases`, the transport answered with the case's status and
    a body carrying its action classifies it as the design record says — `unauthenticated`:
    kept, `reauthentication-required`, stops draining; `rateLimited`: kept, `rate-limited`, stops
    draining, and the wait is read from the header the case names; `invalidRequest`: discarded,
    `rejected-permanently`, with the body's `code` as detail. **A case in the document that the
    test has no expectation for fails the test**, and so does an expectation for a case the
    document no longer has.

### An approved extension (C002's `dimensions`)

The service's test checks *compatibility*: the endpoint may accept more than the document names.
This test checks *equality* in the other direction: **the collector sends nothing the pinned
document does not name.** So a field added to `MEASUREMENT_ENTRY_FIELDS` alone fails assertion 3
— an accident is caught — and the deliberate path for an approved field is exactly two things:

1. the service names the field in its document (for an optional one, under `whenKnown`), raises
   `version`, and the copy and its provenance record are refreshed here;
2. the collector adds the field to `MEASUREMENT_ENTRY_FIELDS` — one line — and to the projection
   that writes it.

Because assertion 3 is a set comparison read from the document, the test file itself needs no
edit for step 1 or for the one-line change. Assertion 4 builds its turns from the document's
examples: if the refreshed examples stay as they are (no `dimensions`), it needs no edit either;
if the service adds an example that carries the new field, the helper that turns an example entry
into a turn gains the line that feeds it, in the same change that teaches `projectMeasurement` to
write it. Either order fails loudly rather than passing by accident: a refreshed document without
the collector's change fails 3, and the collector's change without a refreshed document fails 3.

### The comments

Header of `src/contract/ingest-contract.ts`, replacing its second paragraph:

```ts
 * The authority is the deployed endpoint. What this collector relies on of it is pinned by the
 * service in one document, `apps/api/contracts/collector-ingest.json` of its repository
 * (`botarkdev/agentmeter`, private). A copy is held here as
 * `test/fixtures/collector-ingest.contract.json`, and
 * `test/unit/contract/service-contract.unit.test.ts` fails when this collector departs from it.
 * Nothing here changes the contract, and nothing here re-validates it: a rule of the service's
 * repository requires a schema shared between the API and the collector to live in a shared
 * package rather than be duplicated, so this package defines no second copy of that schema. What
 * it defines is the TypeScript shape of the payload its allowlist projection builds, and the
 * service remains the authority that validates (research.md Decision 10).
```

("the Constitution requires" becomes "a rule of the service's repository requires", as
`CLAUDE.md` asks of a comment that is being edited anyway.)

Above `CLIENT_ACTIONS`:

```ts
/** The closed set of values the service's error contract uses for "what should the client do
 * next" (`refused.actions` in the service's pinned document, which the service compares with its
 * own list exactly: a value outside this list is read here as no action at all). Read to decide
 * whether a batch is retained or discarded (FR-021). */
```

## Decisions needed

1. **How the provenance record names its source while T153 is unmerged.** Recommended: as in
   "The provenance record" — `version` and `sha256` bind, `source.commit` is `null` until the
   squash commit exists on the service's `main`, then filled by hand. Alternatives: (a) record
   the branch commit `9d694c0…` now — exact today, unresolvable after the squash merge, and it
   publishes an identifier of a private repository that will never be reachable; (b) hold this
   branch until T153 is merged and record the real commit — exact, but it blocks a test that
   could be protecting the collector now, on a merge only the owner can make.
2. **Whether the test holds the copy to the recorded SHA-256.** Recommended: yes (assertion 1).
   An edit to the copy — by hand, or by a formatter — then fails until the record is changed too,
   which makes "edit the document so the test passes" a visible two-file change rather than a
   quiet one. Alternative: record the SHA-256 for humans only; smaller, and an edited copy then
   passes.
3. **Whether to assert the request as the transport sends it** (assertion 6: method, URL, header
   names, bearer scheme, body). It is not in the backlog detail's list, but the document pins
   `request.method` and `request.headers`, and nothing else here would fail on a renamed header.
   Recommended: yes. Alternative: leave it out and keep strictly to the listed assertions.
4. **Where the refresh procedure is written.** Recommended: `CLAUDE.md` (a short paragraph under
   "Working here") plus the test's header comment; no new document. Alternative: a
   `test/fixtures/README.md` beside the copy.

## Out of scope

- Any change to what the collector sends or how it reads an answer. If the test, once written,
  shows the collector already departs from the document, that is reported at the implement gate
  and not fixed here.
- Fetching the document, or checking the copy against the service's repository, from a test or
  from CI: the service's repository is private and the tests use no network.
- Automating the refresh.
- The design record under `specs/0019-claude-code-collector/`, which is not edited. (Its example
  request carries an `idempotencyKey` and a `sessionId` that are not visibly placeholders; that
  predates this task, is in a governing path, and is the owner's to judge.)
- Filling `source.commit`: it follows the service's merge of T153.
- A version or a changelog entry: a fixture, a test and comments change nothing that ships.

## Verification

- `taskrail checks C005 --stage test` and `--stage lint`, with their real output.
- `sha256sum` of the committed copy against the value above, and a byte comparison (`cmp`) of it
  with what the service's branch holds.
- **Each assertion seen failing first**, one deliberate change at a time, each restored before
  the next, with the real failing output:
  - the collector: a renamed field in `projectMeasurement`; a field removed from
    `TOKEN_FIELDS` and from the projection's `tokens`; an extra field added to
    `MEASUREMENT_ENTRY_FIELDS` (the C002 accident); a changed batch field in `splitIntoBatches`;
    a changed `INGEST_PATH`; a changed header in the transport; `readAcceptance` reading a
    renamed count; an action removed from `CLIENT_ACTIONS`; a `401` classified as a discard; the
    `429` wait read from another header; `FIX_AND_RETRY` retained;
  - the copy: one value edited in the copied document (the SHA-256 assertion), and separately a
    field renamed in it with the recorded SHA-256 updated to match (the shape assertions);
  - the record: a wrong `version`.
- `git status` clean of anything under `src/` afterwards, and `git diff` of
  `src/contract/ingest-contract.ts` showing comment lines only.
- `pnpm check:package` (part of the `test` stage) still reporting the same packed files.
