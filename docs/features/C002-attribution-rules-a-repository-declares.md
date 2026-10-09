# C002 — Attribution rules a repository declares

**Status**: plan, second revision, awaiting approval. Nothing but this document and its index row
has been written.

**This plan amends rule 2** ("It sends metrics, never content"), on the owner's decision of
2026-10-09 (`docs/autopilot/decisions/C002-attribution-rules-a-repository-declares.md`): for a
repository that committed a rule file, a seventh field goes on the wire, `dimensions`. The first
revision of this plan derived it from the branch name only. The owner widened what a rule may
read; this revision adds what was asked, says what it found about the session name, and stops for
review again before anything is built. What changed is listed under "Changes against the first
plan".

## What the owner decided

| # | Decision |
| --- | --- |
| O1 | The collector may send `dimensions` for a repository that committed a rule file. Rule 2 is amended in a new decision document; the design record is not edited. |
| O2 | A rule may read: the turn's recorded branch name; the session's name, when the user gave it one; a name set in an environment variable that names the source of the metrics. **Not the working directory.** |
| O2b | Only a session name the user set by hand may leave the machine. A title generated from what the user wrote is derived from content and never leaves. If a transcript cannot tell the two apart reliably, no session name is sent. |
| O3 | Whatever a rule's named groups capture, up to 128 characters. |
| O4 | `type` and `key` only. |
| O5 | A turn matching no rule sends no `dimensions` key. |
| S1 | Granularity is not in this task; the file has no `granularity` key. |
| N1 | The file is `.agentmeter.json`; rules have the `from` / `match` / `emit` shape. |

## What exists today

- **The wire.** One measurement is `idempotencyKey`, `occurredAt`, `sessionId` (optional), `model`,
  `pricingTier`, `tokens` (five counters). `src/contract/measurement-projection.ts` writes each by
  name; `MEASUREMENT_ENTRY_FIELDS` lists them; `test/unit/contract/content-safety.unit.test.ts`
  fails when the key set differs or when a marker planted in any content-bearing transcript field
  reaches the serialised batch.
- **The pinned contract.** `test/fixtures/collector-ingest.contract.json` is a byte-for-byte copy
  of the document in which the service pins what the collector sends (version 1), and
  `test/unit/contract/service-contract.unit.test.ts` fails when `MEASUREMENT_ENTRY_FIELDS` names a
  field that document does not. **Version 1 does not name `dimensions`.** See "A dependency
  outside this repository".
- **What a turn carries locally.** A Claude Code transcript event records, beside the usage, the
  working directory (`cwd`) and the branch that was checked out when the turn ran (`gitBranch`).
  `src/claude-code/usage-extraction.ts` is the only module that holds the event. It reads `cwd` to
  hand it to the scope and drops it; it does not read `gitBranch` at all. `UsageTurn` has no field
  either could travel in.
- **What the service's endpoint accepts.** An optional `dimensions` array on a measurement, each
  element `{ type, key, weight?, confidence? }`: `type` and `key` are non-empty strings with no
  vocabulary and no length limit, `weight` defaults to 1 when absent, and the entry admits no
  other field. The endpoint needs no change; its pinned document does.
- **Two properties of the service that shape the plan**, both already relied on by the collector:
  a measurement is identified by its idempotency key alone, and a key that is sent again is
  deduplicated — the first delivery's dimensions stay, the second's are not applied. So
  **attribution is decided at first delivery**; the collector cannot relabel what it has already
  delivered.
- **Configuration.** Every value comes from the environment (`src/config/collector-config.ts`).
  There is no committed file. The repository a run belongs to is already found without spawning
  anything (`src/scope/repository-root.ts`).

## The session name: what a transcript records, and why none is sent

Established from Claude Code's command reference and from the event types and field names of
transcripts on one machine (1 088 files; types, key names and counts only — no value was copied
anywhere).

- A session's name is written as an event of its own, outside the turns: type `custom-title`,
  with the keys `customTitle` and `sessionId`. A second event type, `agent-name` (`agentName`,
  `sessionId`), carried the same value in 85 of the 88 transcripts that had a `custom-title`.
- A title Claude Code generates on its own initiative is a different event: type `ai-title`
  (`aiTitle`, `sessionId`). That one is never confused with a name: it is simply not read.
- **But a `custom-title` is not always typed by the user.** Claude Code's reference for the
  rename command says that, run without a name, it "auto-generates one from conversation
  history". Observed: each of the 4 renames recorded with no argument was followed by a new
  `custom-title` event. A name generated from the conversation and a name typed by hand are
  written as the same event, with the same keys and nothing that marks which is which.
- The only trace of a hand-typed name is elsewhere: the rename command itself is recorded as a
  `system` event (subtype `local_command`) whose `content` holds the command and its arguments. A
  title could be shown to be typed by finding a rename whose argument equals it. That is not a
  reliable test: it matched 54 of 60 typed renames (the name is normalised before it is stored);
  a name given when the session is started, or set from another surface, leaves no such event
  (61 of the 88 transcripts carried their name before their first user event); it means reading
  a field that holds what the user typed; and it needs state that outlives the incremental scan,
  because the rename and the turns it names are read in different runs.

**So this plan sends no session name, and no rule can ask for one**: `"from": "session"` is not a
legal source, and a file that names it is invalid. The `custom-title`, `agent-name` and `ai-title`
events stay unread, as they are today, and the content-safety test plants a marker in each to keep
it so. This is the outcome O2b names for a transcript that cannot tell the two apart. What the
owner wanted from it — a name the user chose, attached to usage — is available through the
environment variable below, which is the user's declared text by construction. See O6.

## Behaviour

A repository commits a file, `.agentmeter.json`, at its root. The file holds attribution rules and
nothing else. Each rule names a source, a regular expression over it, and the dimensions to emit
when it matches:

```json
{
  "version": 1,
  "attribution": [
    {
      "from": "branch",
      "match": "^(?<task>[A-Z][0-9]{3})-",
      "emit": [{ "type": "task", "key": "{task}" }]
    },
    {
      "from": "source",
      "match": "^(?<name>[a-z0-9-]+)$",
      "emit": [{ "type": "checkout", "key": "{name}" }]
    }
  ]
}
```

There are two sources:

- **`branch`** — the branch name recorded on the turn when it was written (not the branch checked
  out when the collector runs: a run reads history).
- **`source`** — the value of the environment variable **`AGENTMETER_SOURCE`**, when it is set. It
  is text the user chose to name where these metrics come from. The collector derives it from
  nothing: not the host name, not the user name, not a path.

With that file and `AGENTMETER_SOURCE=laptop-a`, a turn that ran on the branch `K123-add-export`
is submitted as:

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
      "dimensions": [
        { "type": "task", "key": "K123" },
        { "type": "checkout", "key": "laptop-a" }
      ]
    }
  ]
}
```

`add-export` is not sent: no rule captured it. The same turn with `AGENTMETER_SOURCE` unset
carries the `task` dimension only. A turn on `main` with the variable unset matches no rule and is
submitted exactly as today, with no `dimensions` key at all. A repository with no
`.agentmeter.json` sends exactly what it sends today, **whether or not the variable is set**.

### Exactly what would leave the machine

| On the wire | Value | Derived from |
| --- | --- | --- |
| `dimensions[].type` | a string, 1–64 characters | **A constant** written in the committed file. Never from the machine: `type` admits no placeholder. The vocabulary is the repository's; the collector has none. |
| `dimensions[].key`, from a `branch` rule | a string, 1–128 characters | The rule's `key` template from the committed file: its literal text, with each `{name}` replaced by what the rule's regular expression captured in the named group `name` **from the branch name recorded on that turn**. |
| `dimensions[].key`, from a `source` rule | a string, 1–128 characters | The same, with the captures taken **from the value of `AGENTMETER_SOURCE`** — the user's own declared text, set on their machine. |

Nothing else is new. Specifically, **never derived and never sent**, under any rule a file can
express:

- the working directory, any path or path segment, the transcript's location, the repository's
  name or root;
- the session's name or title, generated or typed (`custom-title`, `agent-name`, `ai-title`);
- message content, tool input or output, file contents, `slug`, `entrypoint`, `error`, `uuid`;
- the host name, the user name, or anything else the collector would have to find out by itself
  to name a source;
- the branch name or the variable's value as such. The only way any part of either reaches the
  wire is a named capture group of a pattern the repository committed. A repository that writes
  `^(?<all>.+)$` with `"key": "{all}"` does send the whole text: that is what it declared, in a
  public, reviewed file. Nothing sends it by default;
- any other environment variable. The endpoint and the token are never a source;
- `weight`, `confidence`, `payload`, a project or a user identity;
- anything at all when the file is absent, unreadable, or not valid.

### The file

- **Where**: `.agentmeter.json` in the root of the repository the run belongs to — the same root
  the scope already finds (`findRepositoryRoot`): the main working tree, also for a session opened
  in a linked worktree. One repository, one rule set per run.
- **Format**: JSON, read with `JSON.parse`. No dependency (rule 3).
- **Keys**: `version` (must be `1`) and `attribution` (an array of rules). A rule has `from`
  (`"branch"` or `"source"`), `match` (a regular expression, as text) and `emit` (an array of
  `{ "type", "key" }`). **Any other key anywhere, and any other `from`, makes the whole file
  invalid** — see "Fail closed". In particular `endpoint`, `token`, `project` and `granularity`
  are not keys of this file.
- **Evaluation**: rules are tried in the order written, **separately for each source: the first
  `branch` rule that matches emits, and the first `source` rule that matches emits.** A specific
  rule placed before a general one of the same source shadows it; a rule of one source never
  shadows a rule of the other, so a turn can carry a task from its branch and a name from the
  variable. Dimensions are sent in the order of the rules that produced them. An `emit` entry
  whose placeholder names a group that did not take part in the match, or whose key comes out
  empty or longer than 128 characters, is dropped; the others are kept. Two identical
  `(type, key)` in one measurement are sent once. A measurement carries at most 16 dimensions.
- **Limits**, all checked when the file is read: at most 64 KiB, 32 rules, 8 `emit` entries per
  rule, 512 characters per pattern, 64 per `type`, 128 per `key` template. A branch name longer
  than 255 characters is not matched.
- **Machine scope** (`AGENTMETER_SCOPE=machine`): no file is read and no dimension is sent, the
  variable included. Such a run reports many repositories, and one repository's rules must not
  label another's turns.

### `AGENTMETER_SOURCE`

- **What it is**: a name for where these metrics come from, chosen by whoever sets it — in the
  same place as the other variables (`README.md`, "Configuration"). It is not a secret.
- **Bounds**: surrounding whitespace is trimmed and an empty value is "not set". A value longer
  than 255 characters, or holding a control character, is treated as not set and reported as an
  `invalid-setting` failure naming the variable, never its value — the rule every other variable
  follows.
- **It becomes a dimension only through a committed rule.** The collector does not know what kind
  of thing the name is, so it has no `type` to send it under; the repository's file says
  (`"type": "checkout"` above is that file's word, not the collector's). The rule's pattern also
  lets a repository say which names it accepts: `^(?<name>laptop-a|laptop-b|ci)$` sends nothing
  for a misspelt one.
- **Set, with no rule file: nothing is sent, and nothing is reported.** The owner's use — one
  token in several folders, each with a name, compared on the service — therefore needs each
  folder to be a repository whose committed `.agentmeter.json` holds a `source` rule. A folder
  without that file, and a run with `AGENTMETER_SCOPE=machine`, sends no name. This is the limit
  of O1 as it was answered ("for a repository that committed a rule file"); lifting it is O7.
- **It names the run that reports, not where a turn ran.** One value per run, applied to every
  turn that run collects. With the default scope a run collects only its own repository's turns,
  so "one name per folder" holds when each folder is its own repository. Linked worktrees of one
  repository are one repository: they share the main working tree's file, and each run labels
  what it collects with its own environment's value.
- **It is fixed at first delivery**, like every dimension: renaming a source labels what is
  collected from then on.

### How the four rules are kept

1. **It can never fail or block a session.** Reading and validating the file never throws; every
   failure is a record in the run's outcome. A regular expression committed by a repository can
   backtrack without bound, and a synchronous match cannot be abandoned by the run's budget — so
   every match runs through `node:vm` with a 50 ms timeout (a Node built-in; verified on Node 22:
   `/^(a+)+$/` against 40 characters is interrupted after 52 ms with
   `ERR_SCRIPT_EXECUTION_TIMEOUT`; 1 000 guarded matches of an ordinary pattern take about
   100 ms). The `source` rules are evaluated once per run; `branch` results are memoised per
   distinct branch name. After the first timeout the rules are switched off for the rest of the
   run, the remaining turns are sent without dimensions, and the run says so.
2. **Metrics, never content — amended, and still enforced by construction.**
   - `usage-extraction.ts` stays the only module that holds a transcript event. It reads
     `gitBranch`, hands it to an attribution function it was given — exactly as it hands `cwd` to
     the scope — and drops it. `UsageTurn` gains `dimensions`, a list of `{ type, key }`; it still
     has no field a branch name, a path or a title could travel in.
   - **The attribution function's input type, as extraction sees it, has one field: `branch`.**
     The variable's value never passes through extraction: it is bound when the function is built,
     once per run, from the resolved configuration. So nothing read from a transcript other than
     the branch can reach a rule, and there is no parameter through which a title or a path could
     be handed over.
   - `from` is a closed set of two values. A file naming a third — `cwd`, `session`, anything —
     is invalid.
   - `projectMeasurement` writes `dimensions` out by name, rebuilding each element as
     `{ type, key }` — nothing spread, nothing passed through. `MEASUREMENT_ENTRY_FIELDS` gains
     `dimensions`; a new `DIMENSION_FIELDS = ["type", "key"]` is exported beside it.
   - Only assistant turns are extracted. `custom-title`, `agent-name` and `ai-title` events are
     not turns and are ignored by the existing first check; a test holds that.
   - **Fail closed**: an unknown key, an unknown `version`, an unknown `from`, a placeholder that
     names no group, a pattern that does not compile, or a limit exceeded makes the whole file
     invalid, and an invalid file means **no dimensions at all**. This is what lets C003 add a
     privacy key later without an older collector ignoring it and sending the value in clear.
3. **Zero runtime dependencies.** `node:fs`, `node:path`, `node:vm`, `JSON.parse`. Nothing added
   to `package.json`.
4. **The service is the authority.** The collector sends two strings per dimension and
   re-validates nothing of the service's. Every `type` on the wire is a word a repository wrote in
   its own file; the collector contributes none, for either source. The field is named in the
   service's pinned document before the collector declares it (next section).

### What an invalid or unreadable file does

The run continues and **submits its measurements without dimensions**, and reports one failure:
stage `attribution`, reason `invalid-rules` (with a closed-vocabulary `detail` naming the check
that failed — `not-json`, `too-large`, `unknown-key`, `unsupported-version`, `unknown-source`,
`invalid-pattern`, `unknown-placeholder`, `limit-exceeded` — never file content, a pattern, a
branch or the variable's value), `unreadable-rules`, or `rule-timeout`. An absent file is not a
failure: it is every repository that never opted in.

The cost is stated plainly: those turns are delivered unlabelled and the collector cannot label
them afterwards. The alternative — hold everything until the file is fixed — risks the tokens
themselves, because transcripts rotate off disk. Tokens cannot be recovered; labels can be
re-applied on the service.

### What the run reports

`RunOutcome.scan` gains `turnsAttributed` (turns that received at least one dimension), printed by
`agentmeter push` as `attributed N` when not zero. `FailureStage` gains `attribution`;
`FailureReason` gains `invalid-rules`, `unreadable-rules` and `rule-timeout`. No outcome field
carries a dimension's value, a branch, a pattern or the variable's value.

## A dependency outside this repository

`test/unit/contract/service-contract.unit.test.ts` holds `MEASUREMENT_ENTRY_FIELDS` equal to the
fields the service's pinned document names, and the document at version 1 does not name
`dimensions`. Adding the field here alone fails that test, by design. The order is the one
`CLAUDE.md` gives ("Refreshing the contract copy"): **the service names the field first.**

**The change in the service's repository**, to `apps/api/contracts/collector-ingest.json`:

1. `"version"`: `1` → `2`.
2. `request.measurementFields.whenKnown`: `["sessionId"]` → `["sessionId", "dimensions"]`.
3. A new key beside `request.tokenFields`: `"dimensionFields": ["type", "key"]`.
4. In `request.examples`, the measurement that already carries every optional field (the first)
   gains `"dimensions": [{ "type": "task", "key": "K123" }]` — invented values. The second
   example, which carries no optional field, is unchanged; the document's own "one with every
   field, one with none" check then still holds.
5. `consumer` names the collector release the document was written against; whether it is updated
   now or when the release that sends `dimensions` exists is the service's convention to follow.
6. In the service's own test of that document, a check that every example dimension has exactly
   the keys in `dimensionFields`. The endpoint's schema already accepts the field, so no schema or
   route changes, and the examples already pass it.

Nothing else in the document changes: `weight` and `confidence` are not named, because the
collector does not send them (O4).

**Then, here, inside this task's implementation** (one pull request, as `CLAUDE.md` asks):
the copy is replaced with the service's file byte for byte — copied, never typed or edited — and
its provenance record updated (`version`, `sha256`, `copiedOn`, `source.commit`, `null` while the
service's change is not on its `main`); every value in the refreshed copy is read before it is
committed; `service-contract.unit.test.ts` learns the new field (the example entry's `dimensions`
is fed into the turn it is projected from, and a new assertion holds `DIMENSION_FIELDS` equal to
the document's `dimensionFields`).

**Consequence for the order of work**: the implementation cannot pass its checks until version 2
of the document exists somewhere it can be copied from. Everything else can be built and tested
before that; the task cannot close without it.

## Decisions needed

### [owner, rule 2] — new in this revision

**O6. No session name is sent.** The plan's finding is that a transcript does not tell a typed
name from one generated out of the conversation, so under O2b none leaves the machine and
`session` is not a source. *Recommended: accept that outcome*; `AGENTMETER_SOURCE` carries a name
the user chose. *Alternative, as a task of its own and not part of this one:* send a session name
only when it equals the argument of a rename command recorded in the same transcript. Costs: it
reads a field that holds what the user typed; it misses names given at start or from another
surface; it needs per-session state kept on disk between runs; and it rests on two observed,
undocumented event shapes.

**O7. `AGENTMETER_SOURCE` with no rule file sends nothing.** *Recommended: keep it so* — it is
what O1 says, the committed file stays the one place that declares what leaves the machine, and
the collector invents no `type`. The limit is real: every folder to be compared must be a
repository with a committed rule file. *Alternatives:* (b) a second variable that names the type,
so the pair works with no file — the declaration then lives in each developer's environment
instead of a reviewed file; (c) a built-in type for it — the collector would be choosing
vocabulary, which rule 4 says it must not.

**O8. A `source` rule may send the variable's whole value**, by the same reasoning as O3 for the
branch: only what a committed pattern's named groups capture, up to 128 characters. Flagged
because O3 was answered about the branch. *Recommended: yes* — the value is the user's own
declared text, set to be sent.

### Ordinary plan decisions — the orchestrator may answer

P1–P3 and P5–P7 are as in the first plan; the orchestrator recorded the answer it would give to
each. P4 changed and P8–P10 are new.

**P1. Where the file is read from.** *Recommended: the root the scope uses (main working tree).*
Alternatives: the worktree the run started in; a path in an environment variable.

**P2. An invalid file.** *Recommended: submit without dimensions and report.* Alternative:
collect nothing until it is fixed.

**P3. Unknown keys.** *Recommended: the whole file is invalid* (fail closed). Alternative: ignore
them.

**P4 (changed). Several matching rules.** *Recommended: first match wins, per source.* With two
sources, "first match wins" over the whole list would let a `branch` rule silence every `source`
rule on the turns it matches, and the two answer different questions. Alternatives: first match
over the whole list (a turn then carries a task or a source name, never both); every matching
rule emits (a general rule can no longer be shadowed by a specific one).

**P5. Bounding a committed regular expression.** *Recommended: `node:vm` with a timeout.*
Alternatives: a pattern language of the collector's own; no bound.

**P6. The limits** (64 KiB, 32 rules, 8 emits per rule, 512/64/128/255 characters, 50 ms), and
new here: at most 16 dimensions per measurement.

**P7. Machine scope.** *Recommended: no file, no dimension*, `AGENTMETER_SOURCE` included.

**P8 (new). The variable's name and the source's name.** *Recommended: `AGENTMETER_SOURCE`, read
by rules as `"from": "source"`.* Alternatives: `AGENTMETER_SOURCE_NAME`; `"from": "environment"`
(reads as "any environment variable", which it must never be).

**P9 (new). A value of the variable that is out of bounds.** *Recommended: treated as not set and
reported as `invalid-setting` naming the variable* — the existing rule for every variable.
Alternative: truncate to 255 characters (sends text the user did not write as such).

**P10 (new). How the contract dependency is sequenced.** *Recommended: the service's change is
made on a branch of its repository while this task is implemented; the copy is taken from that
branch with `source.commit` `null`, and the commit is filled in once it is on the service's
`main`* — or this task simply waits for the service's merge before it closes. The alternative,
merging this task first, is not available: its checks would fail.

## Acceptance criteria

1. With no `.agentmeter.json` in the repository root, every submitted measurement has exactly the
   six fields it has today and no `dimensions` key, with `AGENTMETER_SOURCE` set or unset; no
   failure is recorded for the absence.
2. With a valid file whose `branch` rule matches a turn's recorded branch, the measurement carries
   `dimensions`, each element having exactly the keys `type` and `key`, with `key` built from the
   template and the named captures; `type` is the file's literal.
3. With a valid file whose `source` rule matches the value of `AGENTMETER_SOURCE`, every
   measurement of the run carries that rule's dimensions. With the variable unset, or a value no
   `source` rule matches, none does.
4. A turn whose branch matches no `branch` rule, or that records no branch, and for which no
   `source` rule applies, has no `dimensions` key.
5. Rules are tried in order within each source and only the first matching rule of each source
   emits; a turn matched by one rule of each source carries both rules' dimensions, in rule order.
6. An `emit` entry whose placeholder group did not take part in the match, or whose key is empty
   or longer than 128 characters, is dropped; the rule's other entries are sent; identical
   `(type, key)` pairs are sent once; no measurement carries more than 16 dimensions.
7. A file that is not JSON, exceeds a limit, has an unknown key at any level (including
   `endpoint`, `token`, `project`, `granularity`), a `version` other than `1`, a `from` other than
   `"branch"` or `"source"` (including `"session"` and `"cwd"`), a pattern that does not compile,
   a placeholder in `type`, or a `key` placeholder naming no group of its pattern, yields **no
   dimensions on any measurement** and one `attribution` / `invalid-rules` failure whose `detail`
   is one of the closed codes. The measurements are still submitted.
8. A file that exists and cannot be read yields no dimensions and one `attribution` /
   `unreadable-rules` failure; the measurements are still submitted.
9. A pattern that backtracks without bound, over the branch or over the variable's value, is
   interrupted; the run records one `attribution` / `rule-timeout` failure, sends the remaining
   turns without dimensions, and `runCollector` still resolves. No test asserts on elapsed real
   time.
10. An `AGENTMETER_SOURCE` that is empty or only whitespace is not set. One longer than 255
    characters or holding a control character is not set and yields one `config` /
    `invalid-setting` failure whose `detail` is the variable's name.
11. `runCollector` never rejects and `agentmeter push` exits 0 for every case in 7–10.
12. With `AGENTMETER_SCOPE=machine` no rule file is read and no measurement carries `dimensions`,
    whatever `AGENTMETER_SOURCE` holds.
13. Content safety, extended: under a rule set that captures part of the branch, no marker
    planted in any transcript field — the working directory and the branch included — appears in
    the serialised batch; under a rule set that deliberately captures the whole branch, the
    branch marker appears inside `dimensions[].key` and nowhere else, and every other marker is
    still absent.
14. A transcript holding `custom-title`, `agent-name` and `ai-title` events, each carrying a
    marker, beside a usage turn: under every rule set the tests use, **none of the three markers
    appears anywhere in the serialised batch**, and none of the three events is counted as a turn
    or a skip.
15. No environment value other than `AGENTMETER_SOURCE` can reach a dimension: with marker values
    in the endpoint, the token and every other `AGENTMETER_*` variable, and a `source` rule that
    captures everything, the serialised batch holds only the `AGENTMETER_SOURCE` value, inside
    `dimensions[].key`.
16. The entry's key set equals `MEASUREMENT_ENTRY_FIELDS` (now including `dimensions`) when a
    dimension is present and equals it minus `dimensions` when none is; each dimension's key set
    equals `DIMENSION_FIELDS`.
17. `UsageTurn` and everything downstream of extraction never hold the branch name: a turn
    extracted with an attribution function serialises without the branch marker unless a rule
    captured it.
18. `scan.turnsAttributed` counts the turns that received at least one dimension, and
    `agentmeter push` prints it when it is not zero. No failure `detail` and no outcome field
    contains a branch name, a pattern, the variable's value or a dimension value.
19. A queued batch holds the dimensions computed when it was collected, and is delivered with
    them by a later run.
20. Against the refreshed copy of the service's document (version 2):
    `MEASUREMENT_ENTRY_FIELDS` equals the fields it names, `DIMENSION_FIELDS` equals its
    `dimensionFields`, and each example entry — the one with `dimensions` and the one without —
    is reproduced by the projection value for value. The copy's SHA-256 is the one its provenance
    record states.
21. `package.json` has no `dependencies`; `pnpm test:cov`, `pnpm build`, `pnpm check:package`,
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
  - a block asserts a rule file naming `cwd`, `session`, or any source but the two, is invalid and
    produces no dimensions — so a path or a title cannot be made to travel by configuration;
  - a "titles" block feeds `custom-title`, `agent-name` and `ai-title` events carrying markers
    through extraction and through a whole collected batch, and asserts none appears;
  - a "source" block asserts the variable's value occurs only inside `dimensions[].key`, and that
    markers in every other configuration value occur nowhere;
  - the key-set equality assertions cover the entry and each dimension.
- `test/unit/contract/service-contract.unit.test.ts`: as described under the dependency.
- `test/unit/support/transcripts.ts`: `assistantTurn` gains an optional `gitBranch`; markers and
  fixture events for the three title event types.

Each new assertion is watched failing before the implementation that satisfies it, as the
repository's testing rule requires.

## Affected areas

| Path | Change |
| --- | --- |
| `src/attribution/attribution-rules.ts` (new) | Reads and validates `.agentmeter.json`; compiles rules; the guarded, memoised matcher; binds the source name; returns an attribution function over `{ branch }`, or a failure code. Pure apart from the injected file read. |
| `src/config/collector-config.ts` | `AGENTMETER_SOURCE` → optional `sourceName`, with its bounds and the `invalid-setting` report. |
| `src/claude-code/usage-extraction.ts` | `extractUsageTurn` takes an optional attribution function, reads `gitBranch`, hands it over and drops it. `UsageTurn` gains optional `dimensions`. Header comment updated. |
| `src/contract/ingest-contract.ts` | `MeasurementEntry` gains optional `dimensions`; `WireDimension` type. Comment updated. |
| `src/contract/measurement-projection.ts` | As above. |
| `src/run/collect.ts`, `src/run/run-collector.ts` | Load the rules once per run for a repository-scoped run (injected dependency), pass the attribution function down, count `turnsAttributed`, record failures. |
| `src/run/run-outcome.ts` | `turnsAttributed`; the new stage and reasons. |
| `src/cli/run-cli.ts` | Prints `attributed N`. |
| `src/index.ts` | Exports the new public types; header comment updated. |
| `test/unit/…` | A new `attribution/attribution-rules.unit.test.ts`; additions to the config, extraction, projection, content-safety, service-contract, collect, run-collector, run-outcome and CLI suites; the fixture helper. |
| `test/fixtures/collector-ingest.contract.json`, `…provenance.json` | Refreshed from the service's version 2, byte for byte; never edited. |
| `specs/attribution-rules/decision.md` (new) | What the owner decided, exactly what leaves the machine, why no session name is sent, what it reverses of the design record (FR-025 in part, research Decision 12, "configuration comes from the environment only"), known limits. |
| `README.md` | Rule 2's paragraph; a new "Attribution" section with the file format, the two sources, limits and failure behaviour; `AGENTMETER_SOURCE` in the configuration table; the outcome fields. |
| `CLAUDE.md` | Rule 2 reworded to the amended statement; layout table gains `src/attribution/`; "Key documents" gains the decision; "Not here yet" loses C002; "Configuration" says what the one committed file may hold. |
| `CHANGELOG.md` | `[Unreleased]` entries. The version is not raised here. |
| `docs/features/` | This document and its index. |
| `TASKRAIL.md` | C002's row, through the CLI. |

Not touched: `LICENSE`, `specs/0019-claude-code-collector/`, `package.json` dependencies, the
queue, the cursor, the transport, the workflows,
`docs/autopilot/decisions/C002-attribution-rules-a-repository-declares.md`.

## Changes against the first plan

- **Sources**: one (`branch`) became two (`branch`, `source`). The working directory stays
  excluded, now by the owner's decision rather than by recommendation.
- **`AGENTMETER_SOURCE`** is new: its bounds, how it reaches a dimension, what it does without a
  rule file, and what it names.
- **The session name** was investigated and is not sent; the finding and its evidence are
  recorded, and three title event types gain content-safety markers.
- **Rule evaluation** changed from "first match wins" to "first match wins per source" (P4).
- **A cap of 16 dimensions per measurement** is new (P6).
- **The pinned contract**: the plan now depends on a change to the service's document and
  refreshes the copy here; the first plan's statement that nothing changes on the service was
  written before that document was held here and is corrected.
- **Acceptance criteria** grew from 16 to 21: 3, 10, 14, 15 and 20 are new; 1, 5, 7, 9 and 12
  were extended.
- **Settled and no longer questions**: O1–O5, S1, N1.

## Out of scope

- **Omitting or hashing a dimension** — C003. This plan only makes sure a future privacy key
  cannot be silently ignored (fail closed).
- **A second agent adapter** — C004. The attribution function takes `{ branch }`, not a Claude
  Code event, so another adapter can feed it.
- **The session name as a source** (O6), and **granularity** (S1), and any change to the
  idempotency key.
- **Sources other than the two**: working directory, paths, time windows, commit data, any other
  environment variable.
- **`AGENTMETER_SOURCE` without a rule file**, and under machine scope (O7).
- **Relabelling what was already delivered**, and backfilling history from before the file
  existed.
- **`weight` / `confidence`**, splitting one turn across several keys of a type.
- **The service's endpoint.** It already accepts the field; only its pinned document changes, in
  its own repository, by its own task.
- **Putting the endpoint, the token or the scope in the file.**

## Open questions and risks

- **The task waits on another repository** (P10). Until version 2 of the service's document can
  be copied, the checks cannot pass.
- **Attribution is decided at first delivery.** Turns delivered before the file existed, or while
  it was invalid, stay unlabelled; deleting the scan cursor does not change that, because the
  service keeps the first delivery.
- **The same turn on two lines with two branches.** A turn id can appear on several transcript
  lines (the run keeps the one with the greatest token total, the first on a tie). If those lines
  record different branches, the kept line's dimensions are the ones sent. Rare, and documented as
  a known limit rather than solved.
- **A source name labels what a run collects, including history.** The first run in a folder
  after the variable is set labels every not-yet-delivered turn of that repository with it,
  whenever the turn was written.
- **A dimension value sits in the on-disk queue** until delivered, in the cache directory, like
  the rest of the request body. It never held a token and still does not.
- **The main working tree may not have the file a branch added.** Under P1's recommendation rules
  take effect when they reach the main working tree's checkout.
- **`node:vm` is a boundary for time, not for trust.** It is used only to interrupt a match; the
  pattern is data, never code, and is compiled with `new RegExp` outside the context.
- **The recorded branch of a detached checkout** is whatever Claude Code wrote. It is matched like
  any other text.
- **The title event shapes are observed, not documented.** Nothing here depends on them: they are
  not read. Only the test's markers name them.
- **Size.** Two sources, a configuration variable and a contract refresh are still one plan. A
  session-name source would not be.

## What was read from the service's repository

Only shapes the collector must send, and one behaviour it relies on: that a measurement admits an
optional `dimensions` array of `{ type, key, weight?, confidence? }` and no unknown field; that
`weight` defaults to 1; that neither string has a vocabulary; that a deduplicated key keeps its
first delivery's dimensions; and the key names of the pinned contract document, which is already
held here as a copy. The file name `.agentmeter.json` and the `from` / `match` / `emit` shape
follow the service's architecture proposal, with the owner's agreement (N1); nothing else of that
document is reproduced.
