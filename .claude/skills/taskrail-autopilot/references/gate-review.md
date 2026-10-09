# Gate review

What to check before answering a lane's gate. A gate is answered on evidence you checked yourself,
never on the lane's report alone.

## Every gate

- **Governing documents first.** Answer from the governing documents — `read_first` in
  `autopilot status` — the design they lead to and the task row before your own preference. A
  decision they reserve to humans escalates.
- **Read the evidence yourself.** Open the artifact at the commit the lane names, and read the diff
  by commit range in the lane's worktree (`git log -p <base>..<head>`), not only its summary.
- **Never approve with failing checks.** Re-run the checks in the lane's worktree yourself with
  `taskrail checks <ID>`, which runs them there with the lane's resource values, before the next
  `autopilot next --run`, while those values are still the lane's own.
- **Scope.** Compare `touched` in `autopilot status` with the plan and the touch map. A change
  outside them is a question; a governing path escalates.
- **Every question answered.** Give each of the lane's questions a decision and a reason; when you
  depart from the lane's recommendation, say why.

## Plan-like gates: `plan`, `scope`, `diagnose`, `frame`, `decide`

- The task row's premise still holds on the current mainline; a false premise escalates. If `show`
  reported `prior_work`, the lane looked at it.
- `plan`: each acceptance criterion is testable, together they cover the task row, and the affected
  areas and what is out of scope are explicit. A task too large for its plan is split only with the
  human's agreement.
- `scope`: the change set and its boundary are listed, and nothing has been edited yet.
- `diagnose`: the reproduction shows real output, and the root cause is located in the code, not
  guessed.
- `frame`: the question, the time box, the approach and the evidence that would decide it are
  stated.
- `decide`: the options are compared on reproducible evidence. Such decisions are often listed in
  `escalate_gates`.
- At a lane's first gate, build or extend the touch map from the plan's affected areas.

## `implement` and `fix`

- A test for each acceptance criterion — for a bug, the regression test — was observed failing
  before the code or the fix. Ask for that output when the report lacks it.
- When it is unclear that a test covers the behaviour, break the code on purpose in the lane's
  worktree, see the test fail, and restore the code.
- The artifact maps each criterion to its tests.
- Read the diff by commit range and re-run the checks in the lane's worktree, as for every gate.
- Documentation and changelog follow the repository's rules; work found outside the task is a
  follow-up task, not part of this branch.

## `verify` and other conditional gates after the code (`docs`, `impact`)

- Exercise the result in its real runtime — the CLI, the application, the API — yourself, in a
  scratch environment separate from the lane's when you can, and record what you ran and saw.
- A gap against the plan is fixed in the lane or becomes a follow-up task; say which.

## Close

- `taskrail done <ID>` is committed on its own, and the backlog differs from the mainline only in
  this task's row and rows the task added.
- The checks pass, `taskrail validate` reports no errors, and the artifact, its index row and the
  decision record are committed.
- When a stage's gate was `decisions`, the lane never stopped at that stage's end: apply that
  stage's criteria above to the close review, with the whole diff.
- Every path in the task's `governing_touched` was escalated and answered in its decision record.
  `status` no longer flags a `done-branch` or `discarded-branch` task, so a governing path changed after the last gate
  escalates now; a path missing from `governing_approved` was never approved or changed after
  its approval.
- The branch has no upstream tracking the mainline (`git rev-parse --abbrev-ref @{u}` fails), so no
  plain push can reach the mainline; otherwise `git branch --unset-upstream`.
- Note the `rebase` that `review --json` reported, for the hand-off.

## Rebase: at hand-off or after a merge

- Every conflict belongs to a known class; anything else escalates before you resolve it.
- No conflict markers remain (`git diff --check`), a commit left empty is dropped, and an entry
  duplicated by a move is kept once.
- After class 3, run `taskrail upgrade --force` and commit what it rewrites.
- Re-run the checks with `taskrail checks <ID>`, adding `--resource NAME=VALUE` for each value
  the lane no longer holds, and run `taskrail validate`, then record the rebase in the task's
  record.
