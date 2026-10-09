---
name: taskrail
description: Work a taskrail backlog (a Markdown file, `TASKRAIL.md` by default, grouped by epics) through the taskrail CLI — find, claim, create and close tasks, and follow the procedure every task kind shares. Use whenever a task ID such as T012 is mentioned, when asked what to work on next, when adding tasks or epics, and before running any taskrail-* executor skill.
license: MIT
metadata:
  source: https://github.com/botarkdev/taskrail
---

# taskrail

The backlog is Markdown: the file the repository's config names — `TASKRAIL.md` by default — holds
an `## Epics` table and one section per epic, and an epic may live in its own file instead.
`taskrail show <ID> --json` reports the file a task's row is in. Each task is a table row with a
status (`⬜` pending, `✅` done, `❌` discarded), an ID, a kind, dependencies and a title.

**The CLI owns IDs and statuses.** Never invent an ID, never type a status emoji into a row,
and never reformat a table. Create tasks with `taskrail new`, close them with `taskrail done`
or `taskrail discard`, and bring a closed one back with `taskrail reopen`. Change an existing
task's title, points, dependencies, description, kind or custom columns with `taskrail edit`,
never by editing the row.

## Running the CLI

Run `.taskrail/bin/taskrail <command>` from anywhere in the repository or a task worktree. Add
`--json` whenever you need to read the result, and act on the exit code:

| Exit | Meaning | What to do |
|---|---|---|
| 0 | success | continue |
| 1 | the backlog fails validation | run `taskrail validate`, report the errors, stop |
| 2 | usage, configuration or git error | read the message; fix the invocation or report it |
| 3 | not found | re-check the ID or name |
| 4 | conflict: claimed by someone else | stop and report who holds it |
| 5 | refused: not pending, or blocked | stop and report why |
| 6 | a check failed | report the failing check's output; fix it or stop at the gate |

Useful commands: `next`, `list [--epic E01] [--state pending]`, `show <ID>`, `claims`,
`kind list`.

## Working a task

Follow these steps for every kind. The executor skill for the kind (named in the `skill` field
of `taskrail show`) supplies what happens inside each stage.

1. **Identify.** Use the ID the human gave. If none was given, run `taskrail next --json` and
   propose the first candidate; do not start one on your own.
2. **Inspect.** Run `taskrail show <ID> --json`. Stop if `state` is not `pending` and report
   the claim or `blocked_by` — `done-branch` means the task is already finished on its own
   branch and waits to be merged. If the `skill` field names a different executor than the one you
   are running, stop and name the right one. If `prior_work` lists an artifact, the task's
   branch or commits naming the task, someone may already have worked on it: look at them,
   check that the description's premises still hold, and mention both at your first gate.
   These signals never block on their own. `prior_work.prepared` set means the branch is the
   workspace `taskrail new --workspace` prepared, holding only the task's row, not earlier work.
   `show` also reports the repository's workflow, which the steps below follow: `task_branch`
   (`"task"`, a branch per task, or `"current"`, the checked-out branch), `close.commit`
   (`"stages"` or `"on-done"`), `close.review` (`"publish"` or `"report"`), and each stage's
   effective `gate` and `commit`.
3. **Workspace.** When `task_branch` is `"current"`, skip this step: the task is worked on the
   checked-out branch — whichever it is, the mainline included — so `base`, `worktree` and
   `worktree_base` are `null`, and `taskrail new --workspace`, `taskrail workspace` and
   `taskrail branch` exit 5. Stop and ask only when `branch` is `null` (a detached `HEAD`) or when
   the task's live claim (`claim.branch`) names another branch than `branch`; otherwise go on to
   claiming, in the checkout you are in. Under `"task"`: run `git fetch <base.remote>` first, with
   the mainline's own remote that `show` reported, then `taskrail show <ID> --json --fetch`. The
   `--fetch` does nothing, and says nothing, unless the repository sets
   `[git].branch_record_remote`; where it is set, it brings in the branch names other clones
   recorded, without which a task finished on a branch renamed in another clone reads here as
   pending on a template name. Take `show`'s `base.onto` as the ref to branch from — the local or
   the remote mainline, whichever is further ahead, or, when `base.dependency` names a dependency
   finished only on its unmerged branch, that branch. If `base.diverged` is true, stop and ask
   which one to use; if `base.onto` is null, stop
   and report `base.reason`. If `base.row` is `missing`, the task's row exists only in this
   checkout, and a workspace created from `base.onto` would not contain it: run
   `taskrail workspace <ID> --json` instead of the git commands below. It creates the branch and
   worktree from `base.onto`, moves the row there with its ID and removes it from this checkout;
   commit the row inside the workspace, and the removal here when `removed_from.uncommitted` is
   true and this checkout's branch needs it. If `worktree` is set, create it. The path is relative
   to `worktree_base`, an absolute directory `show` reports the same from every checkout, so run
   `git -C <this checkout> worktree add --no-track <worktree_base>/<worktree> -b <branch> <base.onto>`
   from the checkout you are in; otherwise
   `git switch --no-track -c <branch> <base.onto>`. `--no-track` keeps the base from becoming the
   branch's upstream, so a plain `git push` cannot land on the mainline or a dependency's branch;
   `taskrail review --publish` sets the task's own remote branch as upstream. If the branch
   already exists, stop and ask — someone may have started this task. From here on, work only
   inside that workspace. A task created with `taskrail new --workspace` already has its
   workspace: skip to claiming.
   When the branch needs another name than `branch` — one that depends on what you know only
   now — run `taskrail branch <ID> <NAME>` before creating the workspace and read `show` again.
   To rename it later, run the same command inside the workspace, never plain `git branch -m`
   (if you already did, run it afterwards so taskrail adopts the new name). It renames the local
   branch, keeps the worktree where it is, and never touches a remote branch: it exits 5 for a branch
   already pushed, and renaming one with `--force` is a decision to report at your next gate.
4. **Claim.** From inside the workspace — under `"current"`, the checkout you are in — run
   `taskrail claim <ID>` before any edit. On the task's branch it records that name, so a later
   title edit cannot change it. A `warning` in its result means the workspace is not on the task's
   branch: switch to that branch, or name it with `taskrail branch`, before any edit. Under
   `"current"`, where `taskrail branch` exits 5, a `warning` means a detached `HEAD`: check out a
   branch before any edit.
5. **Stages.** Before the first stage, read the repository's own agent instruction files, if it
   has any, and follow what they ask of the work you are about to do. Take
   `kind_descriptor.stages` in order. Skip a stage whose `applies` is false: its
   column does not match this task. When `applies` and `judgement` are both true, decide whether
   the stage is relevant to this task; to skip it, record the stage and your reason in the
   artifact and in the next gate report — and if its gate is `always`, stop and ask before
   skipping it; a stage whose gate is `decisions` is skipped without asking. For each stage you
   run: do its work (a stage the executor skill does not describe is done as its `summary` says),
   run its checks with `taskrail checks <ID> --stage <stage>`, which runs each command from the
   `checks` map in the task's worktree and reports one it does not define as not configured (say
   so), commit when the stage's `commit` is true, then apply its gate (see *Gates*). `commit` is
   the effective value: under `close.commit` `"stages"`, `commit = false` means a commit is not
   required at that point, not that one is forbidden; under `"on-done"` every stage reports
   `false`, and you commit nothing until the task is done (step 8). Where an executor skill says
   to commit, that holds only when the stage's `commit` is true.
6. **Scope.** Never edit the areas in `never_edit`. Work you discover outside the task's scope
   becomes a follow-up task (see *Creating tasks*); mention it at the next gate. Only fix
   something directly on the way when it is small and inseparable from the task.
7. **Artifact.** Write the kind's document at `artifact`, and add a row for it to
   `artifact_index`, creating that index as a heading plus a table if it does not exist.
8. **Close.** With every check passing, run `taskrail done <ID>` inside the workspace — under
   `"current"`, in the checkout — it marks the row in this branch and releases the claim; the task
   keeps its recorded branch name, and under `"current"` no branch is recorded — and commit as
   `close.commit` says:
   - `"stages"` — commit that status change on its own;
   - `"on-done"` — make one or more logical commits of everything the task changed, the status
     change included, and leave nothing of the task uncommitted.

   Then hand the task off as `close.review` says. Under `"report"` (`task_branch` `"current"`):
   - run `taskrail review <ID> --json`. It fetches, rebases and pushes nothing: read `head`,
     `commits` (the commits naming the task), `upstream` (the branch's upstream and how many
     commits `upstream.ahead` it lacks, or `null`) and `pull_request.title`, a reference title;
   - never rebase, never run `taskrail review --publish` (it exits 5), and never merge;
   - **ask the human before any push**, saying which branch would be pushed and which commits it
     would send. Push with plain `git push` only once the human approves, never with force; without
     approval, push nothing. This holds whatever agent runs the task and whatever else it allows.

   Under `"publish"`:
   - run `taskrail review <ID> --json` on the task's branch, which it reports as `head`. It
     fetches the mainline's remote (`remote`) and reports in `rebase.onto` the base to rebase
     onto: the local or the remote mainline, whichever is further ahead — or, while `rebase.dependency` names an unmerged dependency, that
     dependency's branch; the pull request still targets the mainline. If `rebase.diverged` is
     true, stop and ask which one to use;
   - if `rebase.needed` is true, run `git rebase <rebase.onto>`. When the repository's merge
     driver is installed (`git config merge.taskrail.driver` prints a command), git resolves most
     backlog conflicts itself, and the markers left in a backlog file are the ones it could not.
     Resolve backlog conflicts mechanically: rows added on both sides keep both, and a status cell
     that is `✅` on either side stays `✅`, unless one side has a `Reopens: <ID>` commit the other
     lacks (`git log --grep='^Reopens: <ID>$' <side>`) — then that side's `⬜` stays. Then run
     `taskrail validate`, and stop and ask about any other conflict;
   - choose the pull request title's type and scope. The pull request is squash-merged, so its
     title is the commit that reaches the mainline and drives the next version: use the
     Conventional Commits type of the most significant change (`feat`, `fix`, `docs`, `ci`,
     `refactor`, …; the kind's default fits most tasks) and the affected component as scope, and
     mark incompatible changes as breaking;
   - run `taskrail review <ID> --publish --json [--type <type>] [--scope <scope>] [--breaking]`.
     It pushes the branch to that remote when the repository enables it — exit 4 means the push
     was rejected: stop and report — and returns `pull_request.title`, `body` and `url`.
9. **Hand off.** Report the branch and its base, each commit on one line, every check with its
   actual result, the artifact path, any follow-up tasks, whether the branch was pushed, and the
   pull request title and link — with its body too when the link cannot carry it. Under
   `"report"`, report the branch, each commit, the checks, the artifact, the follow-ups and the
   reports a `decisions` gate carried, whether the human approved a push and whether it was
   pushed, and the reference title; there is no link. Never merge, never delete the branch, and
   remove the worktree only when the human asks.

## Gates

A stage's `gate` decides when you stop. Use the gate `show` reports, which a repository's
override may set, not the one an executor skill's heading names:

- `always` — stop after the stage and wait for explicit approval.
- `conditional` — stop after the stage only if there is something to decide or report; otherwise
  continue.
- `decisions` — stop during the stage as soon as a decision appears, and never at its end to have
  the stage approved or to report. Carry what `conditional` would stop to report — follow-up
  tasks opened, results, stages skipped — to the next stop, or to the close hand-off.
- `none` — continue.

A **decision** is a choice that the task, the artifact already written, the repository's
instructions and the executor skill do not settle, and whose options differ in a way the human
would care about. Every place an executor skill says to stop and ask is one. Under a `decisions`
gate, what an executor skill calls approved is what the artifact records; the human sees it at
the close.

At a gate, stop editing and report: what the stage did; the evidence, with the exact commands
and the relevant real output; each decision needed, as a direct question; what you will do
next; and what you will not do. Approval covers that stage only. At a decision under a
`decisions` gate, ask it as a direct question with your recommendation and the alternatives,
with the evidence it rests on, and continue the stage once it is answered.

If you are a delegated agent with no direct channel to the human, end your turn with that
report — or with the decision or push question — and resume only when told to continue with the
task ID. Never shorten evidence for the
relay: whoever passes it on cannot recover what you leave out.

## On Claude Code

- At a gate, at a decision and before a push, ask the human with the AskUserQuestion tool when it
  is available; otherwise ask in plain text.
- Running as a subagent, you have no channel to the human: end your turn with the gate report or
  the question, and wait to be resumed.
- Create task worktrees with git as described above rather than through a subagent's worktree
  isolation, which picks its own branch name and location.
- Shape every shell command so a permission allowlist can match it: one command per Bash
  call, the taskrail wrapper and files by absolute path, and `git -C <worktree>` or
  `taskrail --root <worktree>` instead of `cd <worktree> && …`. Avoid `&&`, `;` and `|`
  chains, shell variables, `$?` and heredocs, and edit files with the Edit tool: Claude Code
  checks each part of a compound command on its own, so it asks for permission even when
  every part is allowed.
- Run a task's checks with `taskrail checks <ID>`, adding `--stage <stage>` for one stage's
  checks, rather than changing into its worktree: it runs them there — in the checkout under
  `task_branch = "current"` — with the task's autopilot resources, as one command that a single
  allowlist entry covers.

## Creating tasks

```bash
.taskrail/bin/taskrail new --epic E01 --kind bug --title "Short imperative title" \
  [--pts 3] [--depends-on T010,T011] [--description "One line."] [--column Owner=api]
```

Keep the description to one line; put longer detail in a file and link it.

To open a task and start working on it straight away, add `--workspace`. It creates the task's
branch — and worktree, when the repository uses them — from `base.onto` and writes the new row
there instead of in the current checkout, so the task travels with its own pull request rather
than being committed to the mainline first. Commit the row inside that workspace, then claim
the task. It refuses when the mainlines have diverged or the branch already exists.

Without `--workspace` the row is written in the current checkout; on a mainline checkout `new`
warns, since a repository that merges through pull requests has no path for it there. Move such
a row into its own workspace with `taskrail workspace <ID>`, which keeps its ID.

Add epics with `taskrail epic add --name … --objective … [--done-when …] [--own-file]`, and move
a large inline epic to its own file with `taskrail epic split E01`.

## Editing tasks

```bash
.taskrail/bin/taskrail edit T012 [--title "…"] [--pts 5] [--depends-on T010,T011] \
  [--description "…"] [--kind bug] [--column Owner=api] --json
```

Each flag replaces the whole cell, so `--depends-on` takes the complete list (read it from
`taskrail show`), and an empty value clears a cell. The edit is validated before anything is
written: exit 1 means it would leave the backlog invalid — an unknown or cyclic dependency, for
example — and nothing changed. Edit a task you are working on inside its workspace, so the change
travels with the task. `edit` refuses a closed or `done-branch` task (exit 5) and one claimed by
someone else (exit 4); `--force` overrides both, and is a decision to report at your next gate.
A task's recorded branch keeps its name when its title changes; if `branch.recorded` is true in
the result, `edit` has just recorded the existing branch for that reason.

## Reopening a task

When a done or discarded task turns out not to be finished, reopen it only on the human's
say-so:

```bash
.taskrail/bin/taskrail reopen T012 --reason "Totals still round half-down for refunds" --json
```

The reason is not stored in the backlog. Commit the status change on its own, using
`commit_message` from the result — you may adapt its subject line to the repository's
convention, but keep the reason as the body and the `Reopens: <ID>` trailer as its last line.
`taskrail review` repeats that trailer in the pull request description, so it survives a
squash merge.
Report any `dependents`: they are done or claimed on top of a task that is no longer done.

## Commit messages

Pull requests are squash-merged: the title `taskrail review` generates becomes the single
commit on the mainline, in Conventional Commits form. Commits on the task branch exist for
review. Follow the repository's convention for them; if it has none, use one-line Conventional
Commits with the affected component as scope, for example
`fix(billing): round totals half-up`.

Under `task_branch` `"current"` there is no pull request to squash: the commits land on the
checked-out branch as they are. End each subject with the task ID in parentheses —
`fix(billing): round totals half-up (T012)` — so `taskrail review` lists them in `commits`.
