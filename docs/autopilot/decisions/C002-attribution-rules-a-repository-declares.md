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
| O1 | May the collector send `dimensions` at all, for a repository that committed a rule file? It amends rule 2 and reverses part of the design record, in a new decision document. | yes, as planned · no: the task and C003 are discarded or parked | *waiting for the owner* (the lane recommends yes) | |
| O2 | What may a rule read? | the turn's recorded branch name only · also the working directory relative to the repository root | *waiting for the owner* (the lane recommends the branch only) | |
| O3 | How much of the branch may a rule send? | whatever its named groups capture, up to 128 characters · additionally refuse a capture of the whole name until C003 exists | *waiting for the owner* (the lane recommends the first) | |
| O4 | Which fields of a dimension are sent? | `type` and `key` only · also a constant `confidence` or `weight` from the file | *waiting for the owner* (the lane recommends `type` and `key`) | |
| O5 | What does a turn matching no rule send? | no `dimensions` key · a built-in default dimension | *waiting for the owner* (the lane recommends no key) | |
| S1 | The row says the file also declares "the granularity it reports at". Is granularity part of this task? | not in this task, no key · a `granularity` key whose only legal value is `event` · a task of its own | *waiting for the owner* (the lane recommends not here) | |
| N1 | The file name `.agentmeter.json` and the `from`/`match`/`emit` rule shape follow the client-configuration sketch of the service's private architecture proposal. Is taking them into a public repository acceptable? | yes · choose other names | *waiting for the owner* | |

Not yet answered by anyone. When the owner answers, the answers are recorded here with who gave
them.

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
