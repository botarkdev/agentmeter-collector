---
name: taskrail-feature
description: Execute a taskrail task of kind feature — new behaviour delivered from a short approved plan with testable acceptance criteria, without a separate specification process. Use when working a backlog task whose kind is feature.
license: MIT
metadata:
  source: https://github.com/botarkdev/taskrail
---

# taskrail-feature

Follow the `taskrail` skill's procedure; this skill defines the stages. If the feature proves
too large for a short plan, say so at the plan gate instead of writing a long one; the human
may split it into several tasks.

The gate in each heading below is the core kind's default; follow the gate and the `commit` that
`taskrail show` reports for each stage, which a repository may change. "Commit" in a stage holds
only when that stage's `commit` is true. Under a `decisions` gate, where a stage says the human
approves at the gate, record what would be approved in the artifact and continue: stop only for a
decision, and every "stop and ask" below is one.

## plan — gate: always

Write the artifact with these sections:

- **Behaviour** — what the user or caller can do afterwards.
- **Acceptance criteria** — numbered, each one testable.
- **Affected areas** — modules, interfaces, data.
- **Out of scope**.
- **Open questions and risks**.

Commit it. At the gate, the human approves the plan.

## implement — gate: always

1. Write tests for each acceptance criterion, then the implementation.
2. Run the stage's checks.
3. In the artifact, map each acceptance criterion to the tests that cover it.
4. Commit. The gate is a code review.

## verify — gate: conditional

Exercise the feature in its real runtime — the running application, the CLI, the API — not
only through tests. Record what you did and what you saw. Stop at the gate only if the
behaviour differs from the plan.
