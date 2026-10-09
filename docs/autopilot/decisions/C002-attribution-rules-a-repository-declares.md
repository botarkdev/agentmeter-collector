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

## plan decisions the orchestrator would give, once the above are answered

Not given to the lane: they only mean something if O1 is yes, and the owner may change any of
them.

| # | Question | Options | Decision | Reason |
|---|---|---|---|---|
| P1 | Where is the file read from? | the root the scope already uses · the worktree the run started in · a path in an environment variable | as recommended: **the scope's root** | One definition of "the repository" in the collector. |
| P2 | What does an invalid file do? | submit without dimensions and report · collect nothing until fixed | as recommended: **submit without dimensions and report** | Rule 1; token counts cannot be recovered once transcripts rotate. |
| P3 | Unknown keys in the file? | the whole file is invalid · ignored | as recommended: **the whole file is invalid** | A later privacy key (C003) must never be silently ignored by an older collector. |
| P4 | Several matching rules? | first match wins · every match emits | as recommended: **first match wins** | Predictable, and a catch-all rule can close the list. |
| P5 | How is a committed regular expression bounded? | a `node:vm` timeout · an own pattern language · no bound | as recommended: **the `node:vm` timeout** | Rule 1 with no dependency; the lane measured it. |
| P6 | The limits (64 KiB, 32 rules, 8 emits, 512-character pattern, 64-character type, 128-character key, 255-character branch, 50 ms)? | as proposed · other values | as recommended: **as proposed** | None is part of the design. |
| P7 | Under `AGENTMETER_SCOPE=machine`? | no file read, no dimension · the run directory's file | as recommended: **no file, no dimension** | One repository's rules must not label another's turns. |
