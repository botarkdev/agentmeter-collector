# C003 — Privacy controls over attribution

**Status**: plan written, waiting at the plan gate. Nothing is built.

**Three of the decisions below are the owner's, not the plan's** (D1, D4 and D9): each changes
what a published release sends by default, or where a secret-like value lives. They are marked
`[owner]`. The plan gives a recommendation for each and builds none of them until answered.

## What is sent today

Read in `src/attribution/attribution-rules.ts`, `src/claude-code/usage-extraction.ts`,
`src/contract/measurement-projection.ts` and `test/unit/contract/content-safety.unit.test.ts`, at
`2880cdb` (release 0.3.0 plus the backlog row).

A measurement carries `dimensions` only for a repository that committed `.agentmeter.json`, and
only on a turn one of its rules matched. A dimension is `{ type, key }`.

| On the wire | Source | Value on the suite's synthetic fixture |
| --- | --- | --- |
| `dimensions[].type` | A constant of the committed file. It admits no placeholder. | `"task"` |
| `dimensions[].key`, `"from": "branch"` | The rule's key template with what its pattern's named groups captured of the branch recorded on the turn (`gitBranch`). | Branch `K123-MARKER_GIT_BRANCH`: `"K123"` under `^(?<task>[A-Z][0-9]{3})-`; the whole text, `"K123-MARKER_GIT_BRANCH"`, under `^(?<all>.+)$`. |
| `dimensions[].key`, `"from": "source"` | The same, over the value of `AGENTMETER_SOURCE`. | `"laptop-a"` under `^(?<name>[a-z0-9-]+)$`. |

**No dimension is derived from a path.** The source set is closed at two in the parser, and the
content-safety test refuses `cwd`, `path`, `session`, `slug`, `entrypoint`, `uuid` and
`environment` as sources. So of the row's "branch names and paths", only the branch exists to be
governed, plus the declared source name. Nothing else of a measurement is an attribution dimension
(`sessionId`, `model`, `pricingTier` and the counters are not touched by this task).

**The value is always sent as captured.** There is no way to keep the grouping a dimension gives
without the service, and everyone who reads its dashboard, learning the name.

**Where a plain value exists today**, from most to least exposed: the request body; the queued
batch file on disk (it is the request body); the `UsageTurn`; the memoisation map inside
`buildAttributor`. The run outcome, the `agentmeter push` line and failure details hold none (a
test holds that).

## Behaviour

A repository says, for each dimension it emits, how the key leaves the machine. An `emit` entry
of a **version 2** file has a third key, `send`:

```json
{
  "version": 2,
  "hashKey": "<generate one: 32 to 128 characters>",
  "attribution": [
    {
      "from": "branch",
      "match": "^(?<task>[A-Z][0-9]{3})-(?<rest>.+)$",
      "emit": [
        { "type": "task", "key": "{task}", "send": "plain" },
        { "type": "work", "key": "{rest}", "send": "hashed" }
      ]
    },
    {
      "from": "source",
      "match": "^(?<name>[a-z0-9-]+)$",
      "emit": [{ "type": "checkout", "key": "{name}", "send": "omitted" }]
    }
  ]
}
```

| `send` | What leaves the machine |
| --- | --- |
| `"plain"` | The key as built — what 0.3.0 sends. |
| `"hashed"` | `hashed:` followed by 32 hexadecimal characters: a keyed digest of the type and the key. The same type and key under the same `hashKey` give the same value on every machine, so the service still groups by it. The plain key goes nowhere. |
| `"omitted"` | Nothing: the entry emits no dimension. Its rule still counts as the first match of its source. |

With that file, a turn on `K123-add-export` is sent with
`"dimensions": [{ "type": "task", "key": "K123" }, { "type": "work", "key": "hashed:5b1c…" }]`
(digits invented here), and no `checkout` dimension.

- **`send` is required on every `emit` entry of a version 2 file.** There is no default
  treatment to fall back to: an entry without it, or with a word that is not one of the three,
  makes the whole file invalid, and an invalid file sends no dimensions at all.
- **A version 1 file means what it meant in 0.3.0** (D1): every key plain. `send` and `hashKey`
  are not keys of a version 1 file; either one there is an unknown key and invalidates it.
- **`type` is never treated.** It is a constant the repository wrote, derived from nothing on the
  machine, and the service groups by it.
- **The treatment is applied where the key is built**, inside `src/attribution/`, before a
  dimension exists as a value. A hashed or omitted key therefore never reaches the turn, the
  request body, the queued file, the outcome or the printed line.
- **A plain key that begins with `hashed:` is dropped**, so that nothing this collector sends
  under that prefix is anything but a digest.
- **The same entries are dropped under every treatment**: a group that took no part, an empty
  key, a key over 128 characters before treatment. Changing `send` never changes which turns are
  labelled.
- A 0.3.0 collector that meets a version 2 file refuses it (`unsupported-version`) and sends no
  dimensions. That is the fail-closed reading C002 put there for this.

## The decisions

### D1 `[owner]` — the default, and what happens to a file that says nothing

Under C002 nothing flows "by default": only what a committed pattern's groups capture. The
question is what a capture is sent as when the file does not say.

| | Option | What existing 0.3.0 users see on upgrade | Privacy |
| --- | --- | --- | --- |
| A | `send` optional, absent means `plain`; version stays 1 | Nothing | A dimension added later goes in clear by omission. |
| B | `send` optional, absent means `hashed` | Every key they send becomes a digest (or disappears, with no `hashKey`): their series on the service split in two at the upgrade | Private by default. |
| **C** | **Version 2 requires `send` on every entry; a version 1 file is read as 0.3.0 read it** | **Nothing** | **No default exists in a version 2 file, so nothing is in clear by omission; a version 1 file stays as plain as its repository declared it.** |
| D | Version 2 requires `send`; a version 1 file is refused | All their dimensions stop until the file is rewritten; turns delivered meanwhile stay unlabelled for good (a label is fixed at first delivery) | The strictest: nothing plain without the word `plain` in the file. |

*For changing the default (B, D)*: a private repository's branch structure should not travel
because nobody thought about it, and the release is one day old, so few files exist. *Against*:
it silently changes, or stops, what a released version's users send, and B or D in a team that
upgrades one machine at a time costs labels that cannot be re-applied from the collector.

**Recommended: C.** It changes nothing for a 0.3.0 user and makes the treatment a word a reviewer
reads in the diff. Its cost is that a version 1 file is still accepted, plain, with no end date;
D is the same design with that door closed.

**Version**: this is a `feat`, so the next release is 0.4.0 under any option. Under A or C it is
additive. Under B or D it is breaking — which in `0.x` also raises the minor version
(`CLAUDE.md`, "Releasing") and must be written as such under "Changed" in the changelog.

### D2 — where the control is configured

| Option | For | Against |
| --- | --- | --- |
| **The committed `.agentmeter.json`, per `emit` entry** | One reviewed place says what leaves the machine and how; the same for every contributor; already read fail-closed; nothing for a `SessionEnd` hook to pass | A contributor cannot be stricter than the repository. |
| An environment variable | Per developer | The declaration moves out of the reviewed file; two contributors send different shapes for the same branch. |
| A flag of `agentmeter push` | — | The hook command lives in a committed `.claude/settings.json`: a second committed place, with a third precedence to define. |
| A file-level default plus per-entry override | Shorter files | A new entry inherits the default: in clear by omission when the default is `plain`. |

**Recommended: the committed file, per entry, and nothing else.** No precedence to define: there
is one place. A tighten-only variable for one developer ("omit every dimension from this
machine") can be added later without changing this design; it is not in this task (D8).

### D3 — the treatments

`plain`, `hashed`, `omitted`, on any entry of either source. *Alternative*: hash only what the
groups captured and keep the template's literal text readable (`release-{x}` → `release-<digest>`)
— more to explain, and a literal prefix is itself structure. **Recommended: the whole key.**

### D4 `[owner]` — the digest's key, and where it lives

An unkeyed digest of a branch name hides it only from someone who does not try: task ids and
branch names are short and guessable, and anyone who can read the service's data can hash every
likely name and compare. So the digest must be keyed with something that reader does not have.

| | Option | Same value on two machines | Who can reverse it by guessing | Cost |
| --- | --- | --- | --- | --- |
| H1 | SHA-256, no key | Always | Anyone | None. Protects against a glance, not against intent. |
| H2 | HMAC-SHA-256, key in an environment variable (`AGENTMETER_HASH_KEY`) | **Only if every contributor sets the same key.** Otherwise one task is as many keys as machines, and nobody is told. | Whoever has the key | A shared secret to hand to every contributor out of band. Without it on a machine: hashed entries are dropped and reported, and those turns stay without that label for good. |
| **H3** | **HMAC-SHA-256, key in the committed file (`hashKey`)** | **Always: the file is the same checkout for everyone** | **Whoever can read the repository — who already reads its branch names** | **A secret-like value in a committed file. In a public repository it hides nothing. If a private repository is opened later, every digest already sent becomes guessable.** |

The reader a digest is meant to stop is the one who sees the service's data and not the
repository. H2 and H3 stop that reader equally. H3 cannot fragment the grouping, which is the
only reason to hash rather than omit; H2 keeps this project's rule that nothing secret is
committed.

**Recommended: H3**, with the limit stated in the README in those words (a public repository
gains nothing from `hashed`; use `omitted`). **It is the owner's call** because `CLAUDE.md` says
the file "holds attribution rules and nothing else" and that secrets live in the environment.

Either way: Node's `node:crypto`, a built-in (rule 3). A `hashKey` is 32 to 128 characters of
`A–Z a–z 0–9 _ -`; anything else makes the file invalid (`invalid-hash-key`), and the README's
placeholder is deliberately not a legal value. It is required when any entry says `hashed`. It is
never reported, printed or queued.

### D5 — what is hashed, how long, and how a reader tells

- **Input**: the JSON text of the pair `[type, key]`, so a type and a key cannot be re-split into
  another pair, and the same text under two types does not show as the same digest.
- **Length**: the first 128 bits, as 32 hexadecimal characters. Collisions are out of reach for
  any number of keys a project has; 64 characters would only be harder to read.
- **Marker**: the service does not know what a dimension means and must not learn, so the mark is
  in the key itself: the prefix `hashed:`. A dashboard shows `hashed:5b1c…` beside `K123` with no
  change to the service. *Alternatives*: a shorter versioned prefix (`h1:`), less readable; a
  suffix on the `type` (changes a word the repository wrote); a third field on the wire (a
  contract change, D7). **Recommended: `hashed:`**, reserved as above.

Changing `hashKey`, or an entry's `type`, starts a new series on the service, exactly as renaming
a key does.

### D6 — a configuration that is not right

Never the plain value, and never the session:

| What is wrong | Result |
| --- | --- |
| `send` missing or not one of the three words (version 2) | Whole file invalid, `undeclared-treatment`: no dimensions at all. |
| `hashed` with no `hashKey`, or a `hashKey` out of bounds | Whole file invalid, `invalid-hash-key`. |
| `send` or `hashKey` in a version 1 file | Whole file invalid, `unknown-key` (unchanged code path). |
| Computing a digest raises | That entry is dropped. The function that applies a treatment has no path that returns the plain key for anything but `plain`. |
| Anything else | As today: the measurements are submitted without dimensions and the outcome names the check, never a value. `runCollector` resolves; `agentmeter push` exits 0. |

The whole file is refused, rather than only the entry at fault, because that is the rule the file
is already read by, and a half-applied privacy declaration is harder to reason about than none.

### D7 — the service

Nothing in the ingest contract changes, read from the collector's side only: the pinned copy
(`test/fixtures/collector-ingest.contract.json`, version 2) names `dimensionFields` as
`["type", "key"]` and `dimensions` as a field sent when known. A hashed key is a `key`; an
omitted entry is an absent dimension, and a measurement left with none has no `dimensions` key,
as today. `MEASUREMENT_ENTRY_FIELDS`, `DIMENSION_FIELDS`, the projection, the fixture and
`service-contract.unit.test.ts` are not touched. The service stores `project × type × key` and
needs to tolerate one thing it already does: a key it cannot read. *Not verified here*: any
length or character rule the endpoint applies to a key beyond what the copy names; C002's plan
recorded "no vocabulary and no length limit", and a 39-character key of letters, digits and a
colon is inside anything a plain key already is.

### D8 — a dimension added later

Three things keep a new one from going in clear by omission:

1. **In the file**: a version 2 entry without `send` is invalid. A new entry cannot be written
   without the word.
2. **In the code**: a compiled entry's treatment is a required field of a closed union, and the
   one function that turns a match into a dimension switches over it exhaustively. A new source,
   or a new way to build a key, has no other way to produce a dimension.
3. **In the test**: the content-safety suite runs every source against every treatment from the
   exported closed sets, and fails when a source or a treatment exists that it has no case for.

A source added later that should never be sent plain (a path, if the owner ever allows one) is a
restriction that source's own task adds; nothing here prevents it.

Not in this task: a per-developer, tighten-only override; hashing `type`; hashing only the
captures; reporting how many dimensions were hashed or omitted.

### D9 `[owner]` — the documents the lane may not write

- **`CLAUDE.md`** is not edited by this task, and three of its statements stop being true: rule
  2's description of `dimensions`; "holds attribution rules and nothing else"; and "Not here yet
  … privacy controls over attribution". Replacement text is the owner's to approve; a follow-up
  row like C007 carries it. *Proposed*: the lane writes the proposed paragraphs into this
  document at the implement gate and the orchestrator opens the row.
- **`CHANGELOG.md`**: the repository's convention is an entry under `[Unreleased]` per change
  (C002 did so; the version is raised only by the release pull request). *Proposed*: one entry,
  no version change.
- **The guide published in the service's repository**, if it describes `.agentmeter.json`: a row
  in that repository's backlog. This task does not open or read it.

## Acceptance criteria

1. A version 1 file sends exactly what 0.3.0 sent for it: every existing test of attribution
   passes unmodified.
2. A version 2 file whose entry says `plain` sends the key as built.
3. A version 2 entry that says `hashed` sends `hashed:` and 32 lowercase hexadecimal characters,
   equal to the first 32 of HMAC-SHA-256 keyed with the file's `hashKey` over the JSON text of
   `[type, key]`, computed independently in the test. The same input gives the same value from
   two separately built attributors; a different `hashKey`, type or key gives another.
4. A version 2 entry that says `omitted` emits no dimension; a turn left with none has no
   `dimensions` key; the entry's rule still shadows a later rule of its source.
5. Version 2: an entry with no `send`, or any other word, invalidates the file with
   `undeclared-treatment`; `hashed` anywhere with `hashKey` absent, shorter than 32, longer than
   128 or holding another character invalidates it with `invalid-hash-key`. Version 1: `send` or
   `hashKey` invalidates it with `unknown-key`. A version other than 1 or 2 is
   `unsupported-version`. In each case no measurement carries a dimension, one `attribution` /
   `invalid-rules` failure is recorded, and the measurements are still submitted.
6. A plain key beginning with `hashed:` is dropped; the rule's other entries are sent.
7. An entry is dropped for a missing group, an empty key or a key over 128 characters under every
   treatment alike.
8. When computing a digest raises, the entry is dropped and nothing of the plain key is returned.
9. Content safety, for each source (`branch`, `source`) and each of `hashed` and `omitted`, under
   a rule that captures the whole value: the plain value — a marker — occurs **nowhere** in the
   extracted turn, the serialised batch, the file the queue wrote, the run outcome, the line
   `agentmeter push` prints, or anything written to the standard error stream or the console
   during the run. Under `hashed` the batch holds the digest; under `omitted`, no dimension.
10. The `hashKey`, itself a marker, occurs nowhere in the batch, the queued file, the outcome,
    the printed line, or a failure detail — for a valid file and for each invalid one of 5.
11. The suite has a case for every member of the exported source set and of the exported
    treatment set, and fails when either set gains a member it has none for.
12. A dimension still has exactly the keys of `DIMENSION_FIELDS` and an entry those of
    `MEASUREMENT_ENTRY_FIELDS`; `test/fixtures/` and `service-contract.unit.test.ts` are
    unchanged.
13. `runCollector` resolves and `agentmeter push` exits 0 for every case of 5 and 8.
14. `package.json` has no `dependencies` and its version is unchanged; `pnpm test:cov`,
    `pnpm build`, `pnpm check:package`, `pnpm format:check` and `pnpm typecheck` pass with the
    thresholds unchanged.

**How each is shown to hold.** New tests are run and seen failing before the code exists. The
fail-closed paths are then checked by mutation, each made, seen red and reverted: the treatment
switch returning the plain key for an unknown treatment; the digest's failure path returning the
plain key; the parser taking a version 2 entry without `send` as `plain`; the parser taking an
unknown word as `plain`; `hashed` without a `hashKey` falling back to an unkeyed digest;
`omitted` emitting; the reserved-prefix check removed; the `hashKey` put in a failure detail.

## Affected areas

| Path | Change |
| --- | --- |
| `src/attribution/attribution-rules.ts` | Version 2 of the file: `send` per entry, `hashKey`; the closed treatment set; the keyed digest (`node:crypto`); two more closed codes for an invalid file. Version 1 parsing unchanged. |
| `src/run/run-outcome.ts`, `src/index.ts` | Comments only, where they describe what a dimension holds. |
| `test/unit/attribution/attribution-rules.unit.test.ts` | Criteria 2–8. |
| `test/unit/contract/content-safety.unit.test.ts`, `test/unit/support/transcripts.ts` | Criteria 9–12; a marker for the declared source name and one for the `hashKey`. |
| `test/unit/run/run-collector.unit.test.ts`, `test/unit/cli/run-cli.unit.test.ts` | Criteria 5, 9, 10 and 13 through a whole run with the real file queue in a temporary directory. |
| `specs/attribution-privacy/decision.md` (new) | What was decided and why, beside C002's record, which is not edited. |
| `README.md` | "Attribution": the version 2 file, the three treatments, what `hashed` does and does not hide, the `hashKey`, the new failure codes; the paragraph "One more field is sent only if your repository asks for it". |
| `CHANGELOG.md` | One `[Unreleased]` entry, if D9 says so. |
| `docs/features/` | This document and its index row. |
| `TASKRAIL.md` | C003's row, through the CLI. |

Not touched: `CLAUDE.md`, `LICENSE`, `NOTICE`, `package.json`, the lockfile,
`specs/0019-claude-code-collector/`, `specs/attribution-rules/decision.md`, the projection, the
contract types, the fixture, extraction, the configuration, the queue, the cursor, the transport,
the workflows.

## Out of scope

- A path, the working directory or a session's name as a source. None is one, and this task adds
  none.
- Any field of a measurement that is not a dimension.
- Relabelling what was already delivered: a key delivered plain stays plain on the service.
- A per-developer override, hashing a `type`, hashing only the captures (D3, D8).
- Any change in the service or its repository.

## Open questions and risks

- **D1, D4 and D9 wait for the owner.** Under H2 instead of H3 the plan changes in one place:
  `hashKey` leaves the file, `AGENTMETER_HASH_KEY` enters `src/config/`, and a missing key drops
  the hashed entries of a run and reports it once instead of invalidating the file.
- **A digest is not anonymity.** Whoever holds the key — under H3, whoever reads the repository —
  confirms a guessed name at once. It keeps a private repository's names from the service and its
  readers, and nothing more. The README must say so in those words.
- **Mixed collector versions in one team.** A 0.3.0 collector sends no dimensions for a version 2
  file, and those turns stay unlabelled. Moving a repository's file to version 2 is done when
  every contributor's collector is 0.4.0.
- **Switching a key from `plain` to `hashed` starts a new series**; what was delivered plain
  stays readable on the service.
- **The plain key still exists in memory for the length of a run**, inside `src/attribution/`
  (the match, and the memoisation by branch). It is written nowhere.
- **Verification in the real runtime** (the next stage) ran, for C002, against an endpoint under
  the reserved `.invalid` domain. That still asks a resolver for a name. This task would use a
  loopback address with nothing listening, so that nothing leaves the machine at all.
