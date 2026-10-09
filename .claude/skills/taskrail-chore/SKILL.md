---
name: taskrail-chore
description: Execute a taskrail task of kind chore — maintenance, tooling, dependency or configuration work whose change set and boundary are approved before anything is edited. Use when working a backlog task whose kind is chore.
license: MIT
metadata:
  source: https://github.com/botarkdev/taskrail
---

# taskrail-chore

Follow the `taskrail` skill's procedure; this skill defines the stages. A chore is judged by
its boundary: the approved change set is the contract.

The gate in each heading below is the core kind's default; follow the gate and the `commit` that
`taskrail show` reports for each stage, which a repository may change. "Commit" in a stage holds
only when that stage's `commit` is true. Under a `decisions` gate, where a stage says the human
approves at the gate, record what would be approved in the artifact and continue: stop only for a
decision, and every "stop and ask" below is one.

## scope — gate: always

Edit nothing except the artifact.

1. Read the conventions of the area you will touch: nearby code, its README, the repository's
   agent instruction files.
2. Write the artifact with these sections: **Goal**; **Change set**, file by file with what
   changes in each; **Decisions needed**; **Out of scope**; **Verification**, saying how you
   will prove it works.
3. Commit the artifact. At the gate, the human approves the change set and its boundary.

## implement — gate: always

1. Apply the approved change set and nothing else. If something outside it turns out to need
   changing, stop and ask to amend the scope; never widen it silently.
2. Exercise what changed for real — run the script, build the image, start the service — then
   run the stage's checks. Record the actual results under **Verification** in the artifact.
3. Commit. The gate is a code review.

## docs — gate: conditional

Update the documentation the change affects: READMEs, environment templates, agent
instruction files, skills. Open follow-up tasks for anything larger. Commit. Stop at the gate
only if you opened follow-ups or need a decision.
