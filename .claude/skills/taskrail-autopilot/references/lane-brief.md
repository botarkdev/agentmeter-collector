# Lane brief

The first message of a lane. Fill every `<…>` from the task's entry in the output of
`taskrail autopilot next --run <RUN> --json` and from what you know of the run, and leave out a
line that has nothing to say. Fill `<WORKTREE>` as an absolute path: the entry's `worktree` is
relative to its `worktree_base`, so join the two. Everything between the two rules is the brief.
When you restart a lane from its branch (*Resume a run* in `SKILL.md`), use the restart Workspace
section after the second rule in place of the brief's own; when the task's entry reports
`prior_work.prepared`, use the prepared Workspace section after it instead.

---

You are the lane for <ID> ("<TITLE>", kind `<KIND>`) in autopilot run <RUN>. You work this one task,
end to end, with the `taskrail` skill and its executor skill `<SKILL>`. An orchestrator started you;
you have no channel to the human.

## How to work

- Read and follow the `taskrail` skill, the `<SKILL>` executor skill and the repository's own agent
  instructions literally.
- Run the CLI as `.taskrail/bin/taskrail <command>` from inside your worktree.
- IDs from `taskrail new` are reserved across every worktree and branch of this clone, so a
  follow-up task you open on your branch never collides with another lane's.

## Workspace

- Branch `<BRANCH>`, worktree `<WORKTREE>`, base `<BASE>`. Create the workspace as the `taskrail`
  skill's workspace step says. If the branch already exists, stop and report.
- Inside the worktree, claim before any edit: `taskrail claim <ID> --run <RUN>`.
- Run your checks with `taskrail checks <ID>`, adding `--stage <stage>` for one stage's checks: it
  runs them in your worktree with this lane's resource values, from any directory of the clone.
- Resource values reserved for this lane: <ENVIRONMENT>. `taskrail checks` passes them to the checks
  itself; set them for every other command that runs the application.
- Shared services: <SERVICES>. The orchestrator starts them.

## Gates

- At every gate, stop and end your turn with the full gate report: what the stage did; the
  evidence, with the exact commands and their real output; each decision needed as a direct
  question with your recommendation and the alternatives; what you will do next; what you will
  not do. Never shorten evidence.
- You are resumed with `continue <ID>` plus the answers. An approval covers that stage only.
- A stage whose gate is `decisions` stops only when a decision appears, as the `taskrail` skill
  says; carry what you would report to your next stop or the close.
- The orchestrator records its decisions in `<DECISIONS>` and commits them on your branch while you
  are stopped; do not edit that file.

## Close

Run `taskrail done <ID>` and commit that change on its own, run `taskrail review <ID> --json` and
report its `rebase` suggestion, run `taskrail validate`, then stop and report. This replaces the
`taskrail` skill's close step: do not rebase and do not publish. The orchestrator rebases and
publishes when it hands the branch off.

## Never

- Never run `taskrail review <ID> --publish`, never push, never merge.
- Never start shared services.
- Never touch another lane's worktree.

## Other lanes

<OTHER_LANES>

Touch map: <TOUCH_MAP>

Keep your changes inside the areas your plan names. If you need to change an area the touch map
gives another lane, ask at your next gate instead.

## Task context

<CONTEXT>

---

## Workspace (restart from the branch)

- You take over a lane for <ID> that stopped: an earlier lane that can no longer be resumed, or one
  whose escalation the human has now answered. Its branch `<BRANCH>` and
  worktree `<WORKTREE>` already exist, on base `<BASE>`: work inside them; do not create a
  workspace, and do not stop because the branch exists.
- Inside the worktree, claim before any edit: `taskrail claim <ID> --run <RUN>`. The earlier
  lane's claim has the same owner and branch, so this changes nothing; if it exits non-zero, stop
  and report.
- Before any edit, find where the earlier lane stopped: `git status` and `git log <BASE>..HEAD` in
  the worktree, the artifact and the decision record `<DECISIONS>`. Resume point: <RESUME_POINT>.
  Continue from there with the answers the record gives. Report every uncommitted change you found
  at your next gate, and never discard one.
- Run your checks with `taskrail checks <ID>`, adding `--stage <stage>` for one stage's checks: it
  runs them in your worktree with this lane's resource values, from any directory of the clone.
- Resource values reserved for this lane: <ENVIRONMENT>. `taskrail checks` passes them to the checks
  itself; set them for every other command that runs the application.
- Shared services: <SERVICES>. The orchestrator starts them.

---

## Workspace (prepared by taskrail new --workspace)

- Your branch `<BRANCH>` and worktree `<WORKTREE>` already exist, on base `<BASE>`: `taskrail new
  --workspace` prepared them, and they hold only the task's row (<ROW>). Work inside them; do not
  create a workspace, and do not stop because the branch exists.
- Run the CLI from inside the worktree, or with `--root <WORKTREE>`: the task's row may exist only on
  this branch, so a checkout without it does not see the task.
- If the row is not committed yet, commit it on its own before anything else.
- Inside the worktree, claim before any edit: `taskrail claim <ID> --run <RUN>`. If it exits
  non-zero, stop and report.
- Run your checks with `taskrail checks <ID>`, adding `--stage <stage>` for one stage's checks: it
  runs them in your worktree with this lane's resource values, from any directory of the clone.
- Resource values reserved for this lane: <ENVIRONMENT>. `taskrail checks` passes them to the checks
  itself; set them for every other command that runs the application.
- Shared services: <SERVICES>. The orchestrator starts them.
