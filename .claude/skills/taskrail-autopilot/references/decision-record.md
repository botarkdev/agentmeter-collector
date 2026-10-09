# Decision record

One file per task, at the `decisions` path that `autopilot next` and `autopilot status` report,
listed in the index at `decisions_index` — a table with the columns Task, Title and Document; add
the task's row with its first section.

- Write each decision into the record before you give it to the lane.
- Commit the record on the task branch, in the lane's worktree, only while the lane is stopped at a
  gate, so it travels with the task's pull request and never races the lane's own commits.
- Every section uses the same table. Options are short alternatives separated by ` · `; the
  decision is in bold, or "as recommended" when it is the lane's recommendation.
- Run-level decisions (the touch map, conflict handling, the order of hand-off) are recorded with
  `autopilot decision` and copied into each affected task's record.

```markdown
# <ID> — autopilot decisions

Decisions the orchestrator took on the human's behalf while this task ran in an autopilot lane.
Each is recorded before it is given to the lane.

## <stage> gate

Reviewed: <the artifact and its commit>, <the diff range>, <the checks re-run and their results>,
<what was exercised in the real runtime>.

| # | Question | Options | Decision | Reason |
|---|---|---|---|---|
| 1 | <the lane's question> | <option> · <option> | **<decision>** | <reason> |

<Any instruction given with the answers, such as removing scratch directories.>

## Conflict handling agreed for all lanes

| # | Question | Options | Decision | Reason |
|---|---|---|---|---|
| 1 | <which lane edits which files or sections> | <option> · <option> | **<decision>** | <reason> |

## rebase after <IDs merged>

<IDs> were merged into <mainline> (<commits>). The branch was rebased onto <ref>.

| # | Question | Options | Decision | Reason |
|---|---|---|---|---|
| 1 | Conflict in <file> | keep both · stop | **keep both** | <why it is a known class> |

After the rebase: <no conflict markers, the checks and their results, `taskrail validate`>.

## escalated to the human

| # | Question | Options | Decision | Reason |
|---|---|---|---|---|
| 1 | <the question put to the human> | <option> · <option> | **<the human's answer>** | <reason given> |

Answered by <who>.
```
