---
name: taskrail-autopilot
description: Orchestrate a taskrail autopilot run — work several backlog tasks at once in lanes, answer their gates on the human's behalf from the governing documents, record every decision, escalate what the human must decide, and hand finished branches over one at a time. Use only when the human explicitly asks to run the autopilot and gives the number of tasks to complete or names the tasks.
license: MIT
metadata:
  source: https://github.com/botarkdev/taskrail
---

# taskrail-autopilot

You are the **orchestrator**: the session the human talks to. Each task of the run is worked in a
**lane**, a sub-session that follows the `taskrail` skill and the task's executor skill for one
task and stops at every gate. You answer those gates on the human's behalf where the governing
documents allow it, and take everything else to the human. The CLI computes — what to dispatch,
each task's state, resources, merge detection; you judge. Use the CLI as the `taskrail` skill
describes, with `--json` and its exit codes.

## When to run

**Run the autopilot only when the human explicitly asks for it and gives a task count or names the
tasks.** If they ask without either, ask for one and do nothing else. Never start the autopilot on
your own initiative: not because tasks are pending, not from `taskrail next`, and not because this
skill is installed. This rule lives here, in the text every agent reads, not only in metadata.

1. When the human names the tasks, run `taskrail autopilot start --tasks <IDs> --json` with the IDs
   in the order they gave: the run works only those tasks, in that order, and its count is their
   number. Otherwise run `taskrail autopilot start --count <N> --json`, adding `--kinds <kinds>` only
   when the human named kinds. Keep the run ID (`run.id` in the JSON); every later command names it
   as `<R>`.
2. If it exits 5, the repository has not enabled the autopilot: stop and report its message to the
   human. Never change `[autopilot].enabled` yourself, and do not work the tasks some other way
   instead.
3. If it exits 3 for a named task, its row is neither in this checkout nor on a branch taskrail
   knows as the task's: report the message to the human, who may record the branch with
   `taskrail branch <ID> <NAME>` inside its worktree. A task created with `taskrail new --workspace`
   is found from any checkout, since that command records its branch.
4. Any other failure: act on the exit code as the `taskrail` skill says, and stop.

**Plan the count against your own context.** A lane ends with its task; you accumulate every lane's
report, every gate answer and every hand-off, so your session is the one that fills up — and that,
not compaction, is what bounds a run. Measure the cost once for yourself: the context you are
served per dispatched task, over what a session costs before any task starts, against the context
window you have. That is how many tasks you hold. When the human asks for more than that, say so
and propose the count you can hold; the rest goes to a fresh session through *Resume a run*, which
is the planned path for a long backlog and not only a recovery from a lost session.

When the human adds tasks to a run or raises its count, extend that run rather than starting
another: `taskrail autopilot extend <R> --tasks <IDs> --json` for a run started with `--tasks`, which
raises its count by the tasks added, or `taskrail autopilot extend <R> --count <N> --json` for a run
started with `--count`. Extending also needs the human's explicit request; then run `next --run <R>`
to fill the lanes it frees.

## Before the first dispatch

- Run `taskrail autopilot status --json`. Another orchestrator may have lanes in this clone; they
  count toward the same limits, and you never touch them.
- Read the governing documents: the paths in `read_first` in that output
  (`[autopilot].read_first`, which falls back to the `governing` entries), the documents they lead
  to, and the backlog rows of the tasks. Answer gates from them first. Tell the human about any
  entry in `read_first_missing`.

## Dispatch

1. Run `taskrail autopilot next --run <R> --json`. For each task it dispatches, fill
   `references/lane-brief.md` from that task's entry: branch, worktree, `base`, `environment`,
   `decisions`, the executor skill, the other live lanes and the touch map so far. When the entry's
   `prior_work.prepared` is set, the task's branch is a workspace `taskrail new --workspace`
   prepared, holding only the task's row: use the brief's prepared workspace section in place of its
   Workspace section. A branch without it is someone's earlier work, and the brief's own section
   stops the lane. On a run started with `--tasks`, `skipped` says why a named task waits.
2. Start any shared service the lane needs yourself — lanes never do — and launch the lane as a
   sub-session with the brief. Launch the lanes of one dispatch together.
3. Record each lane at once: `taskrail autopilot lane <ID> --run <R> --handle <H> --state running`.
4. A group assigned by judgement (such as "touches the user interface") is set before `next`, with
   `taskrail autopilot lane <ID> --run <R> --group <G>`.
5. `skipped` and `limited_by` say why a task did not start; mention them when they matter.
6. Refill as soon as a lane frees, without waiting for its hand-off: once you have reviewed a
   lane's close (its task is `done-branch`), escalated it to the human, recorded it failed, or its
   task was discarded, run `next --run <R>` again. An escalated or failed lane keeps its workspace
   but frees its lane, and `status` reports such a task with `holds_lane: false`. The run's count
   caps what starts; never start more tasks than the human asked for.
7. A dispatch expires. A task `next` dispatched that no lane has claimed within
   `[git].claim_grace_minutes` (15 by default) reads `pending` again: it no longer holds a lane or
   its resource values, and a later `next`, in any run, may dispatch it again. So launch each lane
   as soon as `next` returns, and let it claim before anything else. A lane launched after its
   dispatch expired can find its branch already created by another lane; it then stops and
   reports, as its brief says. A run a lost session left behind stops holding the lanes it
   dispatched but never claimed in the same way; lanes that claimed keep theirs.

**Task IDs across lanes.** `taskrail new` reserves each ID under a lock shared by every worktree of
the clone, above every ID on any local branch and every reservation not yet used, so two lanes
never receive the same ID: a branch does not allocate from its own backlog alone. A lane may open
a follow-up task with `taskrail new` on its own branch when a gate approves it. Never forbid lanes
to create tasks, or defer follow-ups to the hand-off, for fear of colliding IDs.

## Supervise

Nothing wakes you on a timer. Whenever you wake — a lane stopped, the human wrote — run
`taskrail autopilot status --run <R> --json` and act on it:

- a lane stopped at a gate: answer it (below);
- `silent: true`: read its worktree (`git log`, `git status`, its artifact); if it is stuck,
  escalate;
- `overlaps`: compare them with the touch map; an overlap the map does not cover is a question for
  the lanes involved, or an escalation when they contradict each other. `known_overlaps` are files
  of the known conflict classes: expected, and resolved at hand-off;
- `escalation` not empty: escalate.

## Answer a gate

1. Record it: `taskrail autopilot lane <ID> --run <R> --state gate --gate <stage>`.
2. Check the escalation conditions below; if one holds, escalate instead.
3. Review the stage by `references/gate-review.md`.
4. Write your decisions into the task's record as `references/decision-record.md` shows, **before**
   giving them, and commit the record on the task branch, in the lane's worktree, while the lane is
   stopped.
5. Resume the lane with `continue <ID>` plus the answers, numbered as its questions were.
6. Record it: `taskrail autopilot lane <ID> --run <R> --state running`.

A conditional gate with nothing to decide does not stop a lane; if one stops anyway, let it
continue.

A stage whose gate is `decisions` stops a lane during the stage, only when a decision appears, and
never at the stage's end. Record the stop with `--gate <stage>`, naming the stage the decision arose
in, and answer the decision as above. With no stage-end stops, the close is your first full review
of the lane's diff: apply there the criteria `references/gate-review.md` gives for that stage.

**Touch map.** At each lane's first gate, once its plan names the files and sections it will change,
build or extend the touch map: which lane edits what, what each lane leaves alone, and how the
conflicts you expect will be resolved. Record it with
`taskrail autopilot decision --run <R> --question <text> --decision <text> --reason <text>`, copy
it into every affected task's record, and give it to every live lane when you next resume it.

## Escalate

Stop and ask the human when:

1. a lane's branch touches a governing path not yet approved (`governing` in `escalation` in
   `status`, until the task is `done-branch` or `discarded-branch`; the close review checks `governing_touched` after
   that);
2. the gate is listed in `escalate_gates` (`escalate_gate` in `status`);
3. the governing documents reserve the decision to humans;
4. two lanes contradict each other;
5. a merge conflict falls outside the known classes (below);
6. a task row rests on a false premise;
7. a base has diverged (`base.diverged` or `rebase.diverged`).

To escalate: record `taskrail autopilot lane <ID> --run <R> --state escalated --reason <why>`, run
`taskrail autopilot notify --event escalation --run <R> --task <ID>`, and ask the human a direct
question with the options and your recommendation. Record the answer in the task's record, naming
who gave it. When the answer approves a governing edit, read the edited files, and once they hold
what was approved, run `taskrail autopilot approve-governing <ID> --run <R>` (with `--path` for each
file when the answer covers only some), so later gates do not raise it again. A flagged file whose
content the task's record already shows approved is not a new escalation: record the approval the
same way. A later change to an approved file flags it again. Other lanes keep going meanwhile. Reopening a task needs the human's say-so, as the
`taskrail` skill says.

**An escalated lane holds no lane of the run.** Its task keeps its claim, branch and worktree, and
`next` may start another task in its place, so waiting for a human never stalls the run. When the
human answers:

1. record the answer in the task's record, naming who gave it;
2. record `taskrail autopilot lane <ID> --run <R> --state parked --reason <the answer>`: the task
   keeps its workspace and waits for a lane;
3. run `taskrail autopilot next --run <R> --json`. It sends parked tasks back before any task that
   has never started, oldest answer first, and only while a lane is free; its `parked` list names
   those still waiting and why (`no free lane`, a full group, a resource). Never judge for yourself
   whether a lane is free — `next` computes that, and an answer that arrives while every lane is
   busy waits there, visible in `parked` and in `status` as `holds_lane: false`;
4. for each one it dispatches — its entry has `restart: true` — resume the lane by its handle while
   that still reaches it, or restart it from its branch with the lane brief's restart workspace
   section, giving it the answers; then record the handle with
   `taskrail autopilot lane <ID> --run <R> --handle <H> --state running`.

A lane that cannot finish is recorded
`taskrail autopilot lane <ID> --run <R> --state failed --reason <why>` and reported; run
`taskrail autopilot notify --event lane-failed --run <R> --task <ID>`. It keeps its claim, branch
and worktree as evidence, and its dependents stay blocked.

A run the human abandons — such as one a lost or rewound session left holding lanes — is closed
with `taskrail autopilot close <R> --reason <why>`, only on the human's say-so. It releases the
run's dispatches and resources and hides the run from `next` and `status`; the claims it lists
stay until the human releases them.

## Close and hand off

Lanes stop after `taskrail done` and `taskrail review <ID> --json`, without rebasing or publishing.
Record that stop as a gate named `close`:
`taskrail autopilot lane <ID> --run <R> --state gate --gate close`. Review the close by
`references/gate-review.md`. Then hand branches off **one branch at a time**:
`status` names the next one in `handoff.next`, and none while `handoff.in_review` is set.

A lane whose task was discarded stops after `taskrail discard` the same way; its task reads
`discarded-branch`, is queued and handed off like a `done-branch` one, and is published with
`--type chore`. Once handed off it keeps reading `discarded-branch`: `handoff.in_review` says it
is in review.

1. In the lane's worktree, run `taskrail review <ID> --json`. If `rebase.needed` is true, run
   `git rebase <rebase.onto>`, resolve only the known classes, re-run the checks with
   `taskrail checks <ID>` and run `taskrail validate`, record the rebase in the task's record and
   commit it. `taskrail checks` passes the lane's resource values while its run still records them,
   but the refill after the close may have released them (its `resources` is then empty): pass
   values that no lane in use holds in `status` with `taskrail checks <ID> --resource NAME=VALUE`,
   one flag per resource; it refuses a value another lane holds.
2. Run `taskrail review <ID> --publish --json --type <type> --scope <scope>` there, choosing the
   type and scope as the `taskrail` skill says. Exit 4, a rejected push, escalates.
3. Record `taskrail autopilot lane <ID> --run <R> --state handed-off` and run
   `taskrail autopilot notify --event lane-done --run <R> --task <ID>`.
4. Tell the human, in one message: the task ID, the branch and the base it now sits on, the exact
   pull request title (`pull_request.title`), its body (`pull_request.body`), and the link
   (`pull_request.url`) — or that `review --publish` returned none. A hand-off message without the
   branch, the title or the body is incomplete: never send one. Never merge.

## After a merge

When the human says a branch is merged:

1. Run `taskrail autopilot merged <ID> --cleanup --json`. When `merged` is false, report what was
   checked and clean up nothing; exit 5 names what stopped the cleanup.
2. For each stacked dependent it lists, run its `git rebase --onto` command in that dependent's
   worktree, resolve only the known classes, re-run the checks with `taskrail checks <ID>` for that
   dependent and resource values as at hand-off, and record the rebase. A dependent
   already published is published again with `taskrail review <ID> --publish --json`, which pushes
   with a lease.
3. Hand off the next branch.
4. When `status` reports the run `complete`, report what the run delivered and stop.

## Resume a run

A run outlives the session that started it: its state is in the run file and on the task
branches. When the human asks a new or compacted session to continue a run, resume it rather than
starting another. Resuming needs the human's request but no new count, and never runs
`autopilot start`.

1. Run `taskrail autopilot status --json` and take the run the human names; if more than one run
   could be it, ask. Read the governing documents, the run's `decisions` and each run task's
   decision record, as before the first dispatch.
2. For each lane that is `running`, `gate` or `escalated`, first try to reach it by the handle
   `status` shows. While the handle reaches it, supervise it and answer its gates as usual.
3. When the handle no longer reaches it, restart the lane from its branch, where everything it
   finished is committed. Restart a `running` lane only once `status` reports it `silent`, so an
   earlier sub-session that may still be working never shares the worktree with a new one. Answer
   a `gate` lane's gate first; an `escalated` lane comes back through the queue as *Escalate*
   says, once the human has answered. Fill
   `references/lane-brief.md` with its restart workspace section, naming the last gate the record
   answers and the answers to apply, launch the lane, and record the new handle:
   `taskrail autopilot lane <ID> --run <R> --handle <H> --state running`.
4. Go on as usual for the rest: a `done-branch` or `discarded-branch` task in `handoff.queue` has its close reviewed and is handed off, a
   `dispatched` task whose lane never started expires as *Dispatch* says, a `parked` task is sent
   back by `next` as *Escalate* says, and `next --run <R>` fills the lanes that are free.

## Known conflict classes

Resolve these without the human; anything else escalates.

1. **Backlog rows**, united by ID: a status that is `✅` on either side stays `✅`, unless one side
   has a `Reopens: <ID>` commit the other lacks. Run `taskrail validate` afterwards.
2. **Appended index rows and changelog bullets**: keep all of them, one entry per task.
3. **Installed skill copies and `.taskrail/installed.json`**: make the manifest valid first, merge
   the skill sources, then run `taskrail upgrade --force`.

## Several unmerged dependencies

`autopilot next` never offers a task with several unmerged dependencies. Start one only on the
human's explicit instruction: create the lane's workspace from one dependency's branch, without
tracking it, and merge the others into it. That merge commit is the fork point: once the
dependencies merge, the branch moves with `git rebase --onto <mainline> <merge commit>`. The lane
claims with `taskrail claim <ID> --ignore-deps --run <R>`, and the task's record says why.

## Never

- merge, push other than through `review --publish`, or delete a remote branch;
- let a lane publish, merge, start shared services or touch another lane's worktree;
- approve with failing checks, or on the lane's summary alone;
- start more tasks than the count, or start a run nobody asked for;
- edit run files by hand: run state is written only through the `autopilot` commands.

## On Claude Code

- Launch each lane as a background general-purpose subagent with the Agent tool, with the filled
  lane brief as its prompt, and launch the lanes of one dispatch in a single message so they run
  concurrently. The agent ID is the lane's handle for `autopilot lane --handle`.
- Resume a lane after a gate with `SendMessage` to its agent ID: `continue <ID>` plus the answers.
  A resumed subagent keeps its full context.
- A completion notification wakes you when a lane stops; run `autopilot status` then.
- Lanes cannot ask the human: `AskUserQuestion` is removed from subagents. At an escalation, ask
  the human yourself with `AskUserQuestion` when it is available, otherwise in plain text.
- When the human wants lanes on another model than yours, pass it in the Agent tool's `model`
  parameter.
- Lanes create or use their worktrees with git, as the brief says — a lane in a workspace
  `taskrail new --workspace` prepared uses the existing one — never through the Agent tool's
  worktree isolation, which picks its own branch name and location.
- Nothing wakes you on a timer. A tool that waits on a condition may re-run `autopilot status`
  while lanes work, but nothing may depend on it.
- Use the command shape of the `taskrail` skill's Claude Code notes yourself — one command
  per Bash call, absolute paths, `git -C` and `taskrail --root` rather than `cd … &&` — and
  re-run a lane's checks at a gate or at hand-off with `taskrail checks <ID>`, which runs them
  in its worktree with its resources.
- **A measured figure for *Plan the count against your own context*.** Nine autopilot runs of
  taskrail's own repository were harvested on Claude Code, all on one 1M-context model: the two
  long runs cost their orchestrator 36,728 and 44,343 tokens of context per dispatched task, over a
  session overhead of 32,000–39,000 — **roughly 21 to 26 tasks in a 1M context**. Lanes were never
  the constraint: 38 of them peaked between 78,404 and 355,752 tokens, and neither they nor any
  orchestrator ever compacted. Start from that band, and measure your own if your model or your
  window differs — the band scales with the window, so the same rate against 200k is four or five
  tasks.
