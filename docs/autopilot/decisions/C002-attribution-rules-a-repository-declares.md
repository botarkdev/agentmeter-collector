# C002 — autopilot decisions

Decisions the orchestrator took on the human's behalf while this task ran in an autopilot lane
(run 20261009-1). Each is recorded before it is given to the lane. The branch starts from C001's
unmerged branch.

## plan gate

Reviewed: `docs/features/C002-attribution-rules-a-repository-declares.md` at `4256ef9`, the range
`origin/C001-adopt-taskrail-with-a-backlog-of-the-col..4256ef9` (the plan and its index row,
nothing else). Nothing was built. The plan stage has no configured checks.

The gate was not answered. The plan asks for a new field on the wire, `dimensions`, whose value is
derived from the git branch recorded on a turn. This repository's second rule says that nothing
derived from the git branch is transmitted and that a new field on the wire is a decision for the
owner, not an implementation detail. It was escalated, and the lane was stopped.

## escalated to the human

| # | Question | Options | Decision | Reason |
|---|---|---|---|---|
| O1 | May the collector send `dimensions` at all, for a repository that committed a rule file? | yes, as planned · no | **yes** | The owner's answer. Rule 2 is amended in a new decision document; the design record is not edited. |
| O2 | What may a rule read? | the turn's recorded branch name only · also the working directory | **the branch name; the session's name when the user gave it one; and a name set in an environment variable — not the working directory** | The owner's answer, in their words: the branch, and the session's name if it has one; not the directory, but an environment variable that names the source of the metrics, so that one token used in several folders can give each a different name and compare them. |
| O2b | Which session name may leave the machine? | only a name the user set by hand · any name, generated titles included · left for a later task | **only a name the user set by hand** | The owner's answer. A title generated from what the user wrote is derived from content and never leaves. If a transcript cannot tell the two apart, none is sent and the owner is told. |
| O3 | How much of the branch may a rule send? | whatever its named groups capture, up to 128 characters · never the whole name until C003 | **whatever its named groups capture** | The owner's answer. |
| O4 | Which fields of a dimension are sent? | `type` and `key` only · also a constant `confidence` or `weight` | **`type` and `key` only** | The owner's answer. |
| O5 | What does a turn matching no rule send? | no `dimensions` key · a built-in default dimension | **no `dimensions` key** | The owner's answer. |
| S1 | Is granularity part of this task? | not in this task · a task of its own now · a key with one legal value | **not in this task**, and no key | The owner's answer. |
| N1 | Are the file name `.agentmeter.json` and the `from`/`match`/`emit` rule shape used in the public repository? | yes · other names | **yes** | The owner's answer. |

Answered by the repository owner, on 2026-10-09, to the orchestrator's questions. O2 widens the
plan as written: two sources are added, so the plan is revised and reviewed again before anything
is built.

## plan gate, second revision

Reviewed: the revised plan at `a16e883`, the range `8cae07c..a16e883` (the plan artifact, nothing
else). Nothing was built. The lane established from the structure of local transcripts — event
types, key names and counts only, no value read out — that a name typed by the user and a name
generated from the conversation are recorded as the same event with the same keys, so the two
cannot be told apart reliably.

| # | Question | Options | Decision | Reason |
|---|---|---|---|---|
| O6 | No session name can be sent reliably. How is the plan closed? | the branch and `AGENTMETER_SOURCE`, no session name · also a type variable so the name works with no rule file · try the session name by matching a recorded rename | **the branch and `AGENTMETER_SOURCE`; no session name** | The owner's answer, on 2026-10-09. O2(b) is closed as not possible reliably; the three title events stay unread and a test holds that. |
| O7 | Does `AGENTMETER_SOURCE` send anything without a committed rule file? | no · yes, with a second variable naming the type | **no** | The owner's answer: the same option. The vocabulary stays in a reviewed file; a folder without the file sends no name. |
| O8 | May a `source` rule send the variable's whole value, up to 128 characters? | yes · no | **yes** | It follows from the owner's answer to O3 and from the option chosen for O6: the value is the user's own declared text, and a rule captures what its committed pattern says. Recorded by the orchestrator as following from those answers, and pointed out to the owner at hand-off. |

Answered by the repository owner for O6 and O7.

## plan decisions given to the lane

| # | Question | Options | Decision | Reason |
|---|---|---|---|---|
| P1 | Where is the file read from? | the root the scope already uses · the worktree the run started in · a path in an environment variable | as recommended: **the scope's root** | One definition of "the repository" in the collector. |
| P2 | What does an invalid file do? | submit without dimensions and report · collect nothing until fixed | as recommended: **submit without dimensions and report** | Rule 1; token counts cannot be recovered once transcripts rotate. |
| P3 | Unknown keys in the file? | the whole file is invalid · ignored | as recommended: **the whole file is invalid** | A later privacy key (C003) must never be silently ignored by an older collector. |
| P4 | Several matching rules? | first match wins per source · first match over the whole list · every match emits | as recommended: **first match wins per source** | Otherwise a branch rule would silence every source rule. |
| P5 | How is a committed regular expression bounded? | a `node:vm` timeout · an own pattern language · no bound | as recommended: **the `node:vm` timeout** | Rule 1 with no dependency; the lane measured it. |
| P6 | The limits? | as proposed, plus at most 16 dimensions per measurement · other values | as recommended: **as proposed** | None is part of the design. |
| P7 | Under `AGENTMETER_SCOPE=machine`? | no file read, no dimension, `AGENTMETER_SOURCE` ignored · the run directory's file | as recommended: **no file, no dimension** | One repository's rules must not label another's turns. |
| P8 | The names? | `AGENTMETER_SOURCE` and `"from": "source"` · `AGENTMETER_SOURCE_NAME` · `"from": "environment"` | as recommended: **`AGENTMETER_SOURCE`, `"from": "source"`** | "environment" reads as any variable, which it must never be. |
| P9 | An out-of-bounds value of the variable? | treated as not set and reported · truncated | as recommended: **not set, reported `invalid-setting`** | The existing rule for a bad setting; a truncated name is a wrong name. |
| P10 | How is the dependency on the service's pinned document sequenced? | the service's change on a branch while the lane builds, the copy taken from that ref · wait for the service's merge | as recommended: **in parallel** | The orchestrator opens the task in the service's repository and names the ref; `source.commit` stays `null` until that change is on the service's `main`. |

## implement gate

Reviewed: the range `456f37a..f6d10bf`. Read by the orchestrator: `guardedMatch` in
`src/attribution/attribution-rules.ts` (one fixed script, `pattern.exec(text)`, run in a `node:vm`
context under a timeout; any error is a timeout, which switches the rules off), the place in
`src/claude-code/usage-extraction.ts` where the recorded branch is handed to the attribution
function as its single property and each returned dimension is rebuilt by name, and the whole diff
of `CLAUDE.md`. Reported by the lane: 40 tests red before the code existed; four deliberate breaks
of the enforcement, each going red and reverted; `lint`, the build and the package check passing;
`test` failing in exactly three tests of the service-contract check, which pass in a throwaway
copy once the fixture is the service's version 2. The fixture was not edited.

| # | Question | Options | Decision | Reason |
|---|---|---|---|---|
| 1 | Is the implementation approved? | approve · amend | **approve** | It follows the approved plan; the three departures (one more closed detail code, `invalid-shape`; `turnsAttributed` counting measurements; a stray brace reported as `unknown-placeholder`) change no design. |
| 2 | Does `CLAUDE.md`'s rule 2 keep the lane's addition that a new source a rule may read is the owner's decision? | keep · remove | **keep** | It is what the owner did with O2, written down; pointed out to the owner at hand-off, as every edit of that file is. |
| 3 | Where is the service's version 2 copied from, and what is `source.commit`? | the service's task branch, `source.commit` null · wait for the merge | **the local branch `T184-name-the-attribution-dimensions-in-the-c` of the service's clone, path `apps/api/contracts/collector-ingest.json`, SHA-256 `398e7fab0b58a9712755edc31f93ff42838ee7bf846c662d6bb3a42761908bd6`; `source.commit` null** | The service's task T184 is closed on that branch and reviewed, not yet merged; the service squash-merges, so only the squash commit will exist on its `main`. |

## close

Reviewed: the range `0e75b35..927dd17` — the contract copy refreshed to the service's version 2
(its SHA-256 recomputed by the orchestrator and equal to the one named at the implement gate), the
provenance record, the record of the verify stage, and the status change committed on its own. The
lane ran the built binary in a throwaway repository with an emptied environment and read the
queued request bodies: dimensions as the rules declare them, none under an invalid file, a
runaway pattern or no file, and nothing sent anywhere. Re-run by the orchestrator: `taskrail
checks C002` — `test` and `lint` passed; `taskrail validate` — 0 errors. `version` in
`package.json` is unchanged.

| # | Question | Options | Decision | Reason |
|---|---|---|---|---|
| 1 | Is the close approved? | approve · hold | **approve** | The plan the owner approved is built, enforced by tests seen failing, and exercised in the built binary. |
| 2 | Which pull request title? | the generated one · `feat(C002:attribution): send the dimensions a repository declares in committed attribution rules` | **the lane's** | New behaviour on the wire, breaking nothing: a repository without the file sends what it sent before. |
| 3 | Is the version raised in this pull request? | a separate release pull request · here | **left to the owner; not raised here** | This repository releases when `version` rises, and its instructions make a release one pull request of its own. |

For the owner: the copy of the service's contract was taken from the service's task T184 before it
merged, so `source.commit` is null — merge T184 in the service first; if its document changes
before it merges, this copy must be refreshed. A `source` rule may send the whole value of
`AGENTMETER_SOURCE`, up to 128 characters (O8). Rule 2 of `CLAUDE.md` is reworded.
