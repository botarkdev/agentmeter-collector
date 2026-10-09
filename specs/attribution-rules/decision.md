# A repository declares how its usage is attributed

**Date**: 2026-10-09. **Status**: decided by the owner; implemented with this document.

**It amends the collector's second rule** — "it sends metrics, never content" — and reverses three
things `specs/0019-claude-code-collector/` still states as they were decided: FR-025, in the part
that says nothing derived from the git branch is transmitted; research Decision 12, "nothing this
feature builds derives a dimension"; and the clarification that configuration comes from the
caller's environment only. That record is not edited. Everything else in it holds.

## The problem

The service stores a measurement against a project, and against whatever _dimensions_ the client
attaches to it: pairs of a type and a key that the service does not interpret. The collector
attached none, so a project's usage could be read by day, by model and by session, and by nothing
a team actually plans in: a task, a piece of work, a checkout.

What a turn should be charged to is the repository's knowledge, not the collector's and not the
service's. One repository names its branches after tasks; another does not. So the rules have to
be the repository's, declared where its contributors can read and review them.

## What was decided

**A repository may commit `.agentmeter.json` at its root, holding attribution rules, and the
collector then sends a seventh field, `dimensions`.** A repository without the file sends exactly
what it sent before. The owner answered each of the following; the questions and the options that
were not taken are in `docs/features/C002-attribution-rules-a-repository-declares.md`.

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

**A rule may read one of two things, and the set is closed:**

- `branch` — the branch name recorded on the turn when it was written. Not the branch checked out
  when the collector runs: a run reads history.
- `source` — the value of the environment variable `AGENTMETER_SOURCE`: a name the user declared
  for where these metrics come from. The collector derives it from nothing.

**Not the working directory**, nor any path.

**A dimension is a `type` and a `key`, and nothing else.** `weight` and `confidence`, which the
endpoint also defines, are not sent.

**A turn that no rule matches carries no `dimensions` key at all.** The collector has no default
dimension. A repository that wants one writes a last rule that matches everything and emits a
constant key.

**Which measurements a run reports, and at what granularity, is not in the file.** The first is
the repository scope's (`specs/repository-scope/decision.md`); the second stays one measurement per
turn. The endpoint and the token stay in the environment.

## Exactly what leaves the machine

| On the wire | Value | Derived from |
| --- | --- | --- |
| `dimensions[].type` | a string, 1–64 characters | A constant written in the committed file. It admits no placeholder, so it is never built from anything on the machine. |
| `dimensions[].key`, from a `branch` rule | a string, 1–128 characters | The rule's `key` template: its literal text, with each `{name}` replaced by what the rule's pattern captured in the named group `name` from the turn's recorded branch name. |
| `dimensions[].key`, from a `source` rule | a string, 1–128 characters | The same, with the captures taken from the value of `AGENTMETER_SOURCE`. |

With the file above and `AGENTMETER_SOURCE=laptop-a`, a turn recorded on `K123-add-export` is sent
with `"dimensions": [{ "type": "task", "key": "K123" }, { "type": "checkout", "key": "laptop-a" }]`
beside the six fields it always had. `add-export` is not sent: no rule captured it.

Never derived and never sent, under any rule a file can express:

- the working directory, any path, the transcript's location, the repository's name or root;
- a session's name or title (below);
- message content, tool input or output, file contents;
- the host name, the user name, or any environment variable other than `AGENTMETER_SOURCE`;
- the branch name or the variable's value as such. Either reaches the wire only as what a
  committed pattern's named groups capture. A repository that writes `^(?<all>.+)$` with
  `"key": "{all}"` does send the whole text; that is what it declared, in a file its contributors
  review. Nothing sends it by default;
- anything at all when the file is absent, cannot be read, or is not valid.

## Why no session name is sent

The owner allowed a third source — the session's name — on one condition: only a name the user
set by hand. A title generated from what the user wrote is derived from content.

Claude Code records a session's name as an event of its own, outside the turns: type
`custom-title`, with a `customTitle`. A second event type, `agent-name`, carries the same value. A
title Claude Code generates on its own initiative is a third, `ai-title`. But the rename command,
run without a name, generates one from the conversation, and that name is written as the same
`custom-title` event, with the same keys, as a name typed by hand. Nothing in the event says which
it is.

The only trace of a typed name is the rename command's own record, and matching a title against
its argument is not a reliable test: the name is normalised before it is stored, a name given when
the session starts or from another surface leaves no such record, the record is a field that holds
what the user typed, and the match needs state that outlives one incremental scan.

**So none is sent**, and the owner confirmed that outcome. `session` is not a source; a file that
names it is invalid. The three events are not read: they are not turns, and extraction ignores
every line that is not one. `test/unit/contract/content-safety.unit.test.ts` plants a marker in
each and fails if it reaches the wire. A name the user chooses is what `AGENTMETER_SOURCE` carries.

## `AGENTMETER_SOURCE`

It exists so that one token used in several folders can give each a name and the service can
compare them.

- Whitespace around it is trimmed, and an empty value is "not set". A value longer than 255
  characters, or holding a control character, is not truncated or cleaned into a name nobody
  chose: it is treated as not set and reported as an `invalid-setting` failure naming the
  variable, never its value.
- **It becomes a dimension only through a committed `source` rule.** The collector does not know
  what kind of thing the name is, so it has no `type` to send it under; the repository's file
  says. The rule's pattern also says which names are accepted.
- **Set, with no rule file: nothing is sent.** Each folder to be compared must therefore be a
  repository whose committed file holds a `source` rule. That limit is the owner's decision: what
  leaves the machine is declared in a reviewed file, never in one developer's environment alone.
- **It names the run that reports.** One value per run, applied to every turn that run collects,
  whenever the turn was written. A run collects only its own repository's turns, so "one name per
  folder" holds when each folder is its own repository; the linked worktrees of one repository
  are one repository.

## How the rules are read

- **Where**: the root of the repository the run belongs to — the root the scope already finds, so
  the main working tree, also for a session opened in a linked worktree. Rules take effect when
  they reach that checkout.
- **Order**: rules are tried as written, separately for each source. The first `branch` rule that
  matches emits, and the first `source` rule that matches emits. A specific rule before a general
  one of the same source shadows it; a rule of one source never shadows a rule of the other.
- **What is dropped**: an `emit` entry whose placeholder names a group that took no part in the
  match, or whose key comes out empty or longer than 128 characters. The rule's other entries are
  sent. An identical pair is sent once. A measurement carries at most 16 dimensions.
- **Limits**: 64 KiB of file, 32 rules, 8 `emit` entries per rule, 512 characters per pattern, 64
  per `type`, 128 per `key` template. A branch name longer than 255 characters is not matched.
- **A run that reports the whole machine** (`AGENTMETER_SCOPE=machine`) reads no rule file and
  sends no dimension, the variable included: one repository's rules must not label another's
  turns.

## How it is enforced

Not by this document. By construction, and by tests that fail when it stops holding.

- **The module that holds a transcript event is still the only one.** It reads the recorded
  branch, hands it to the attribution function the run was given — as the single property of an
  object it builds — and drops it. That function's input type has one field, `branch`. There is
  no parameter through which a path, a title or a line of content could be handed to a rule.
- **The declared source name never passes through that module.** It is bound when the attribution
  function is built, once per run, from the resolved configuration.
- **A turn carries dimensions, not a branch.** `UsageTurn` gained a list of `{ type, key }` and
  still has no field a name or a path could travel in.
- **The projection writes `dimensions` out by name**, rebuilding each as `{ type, key }`.
  `MEASUREMENT_ENTRY_FIELDS` names the field and `DIMENSION_FIELDS` a dimension's two.
- **The source set is closed in the parser.** A file naming any other is invalid.
- **The service names the field first.** `test/unit/contract/service-contract.unit.test.ts` holds
  the collector's declared fields equal to the ones the service's pinned document names; the
  field was added to that document, as its version 2, before the collector declared it.

The content-safety test now also holds: under a rule that captures a part of the branch, no
marker planted in any transcript field reaches the serialised batch; under a rule that captures
the whole branch, the branch marker occurs once, inside a dimension's key, and every other marker
is absent; a file that asks for any source but the two is refused; and a marker in a
`custom-title`, an `agent-name` or an `ai-title` event occurs nowhere, under any rule set.

## Fail closed

An unknown key at any level, a `version` other than `1`, an unknown source, a pattern that does
not compile, a placeholder that names no group of its pattern, a placeholder in a `type`, or a
limit exceeded makes **the whole file invalid, and an invalid file means no dimensions at all**.

That is deliberate, and it is for what comes next: a later version may add a key that says a
dimension must be omitted or hashed. A collector that ignored a key it did not know would read
that file and send the value in clear.

## What it does not change

**The run still cannot fail a session.** Reading and validating the file never throws. A committed
pattern can backtrack without bound, and a synchronous match cannot be abandoned by the run's
budget, so every match runs through `node:vm` with a 50 ms timeout — a Node built-in, used to
interrupt a match and for nothing else: the pattern is data, compiled outside the context. The
declared name is matched once per run and each distinct branch once. After the first timeout the
rules are switched off for the rest of the run.

**Tokens are never held back for a label.** An invalid file, an unreadable file or a timeout
costs a run its dimensions and nothing else: the measurements are submitted without them, and the
outcome says why — stage `attribution`, reason `invalid-rules` (with the code of the check that
failed), `unreadable-rules` or `rule-timeout`. A file that is not there is not a failure.

**Zero runtime dependencies.** The file is JSON.

**The service learns no vocabulary.** Every `type` on the wire is a word a repository wrote.

## What it costs

- **Attribution is decided when a measurement is first delivered.** The service identifies a
  measurement by its key and keeps the first delivery. Turns delivered before the file existed, or
  while it was invalid, stay unlabelled, and deleting the scan cursor does not change that.
  Relabelling is the service's, by another operation.
- **A dimension's value sits in the on-disk queue** until it is delivered, in the cache directory,
  with the rest of the request body.
- **The outcome gained one count**, `scan.turnsAttributed` — the measurements that carry at least
  one dimension — printed as `attributed N` when it is not zero. No outcome field holds a
  dimension, a branch, a pattern or the declared name.

## Known limits

- **The same turn on two lines with two branches.** A turn can appear on several transcript lines;
  the run keeps the one with the greatest token total, the first on a tie, and with it that line's
  dimensions.
- **A declared name labels history too.** The first run after the variable is set labels every
  turn of the repository that had not yet been delivered.
- **The branch of a detached checkout** is whatever Claude Code recorded, and is matched like any
  other text.
- **The title events' shapes are observed, not documented.** Nothing depends on them: they are not
  read.
- **Omitting or hashing a dimension** is not here; it is the next task, and the reason the file is
  read fail-closed.
