---
name: taskrail-bug
description: Execute a taskrail task of kind bug — reproduce it with evidence, find and document the root cause, and fix it under a regression test that was observed failing first. Use when working a backlog task whose kind is bug.
license: MIT
metadata:
  source: https://github.com/botarkdev/taskrail
---

# taskrail-bug

Follow the `taskrail` skill's procedure; this skill defines the stages. Quote commands, error
messages and outputs exactly — the evidence is the deliverable.

The gate in each heading below is the core kind's default; follow the gate and the `commit` that
`taskrail show` reports for each stage, which a repository may change. "Commit" in a stage holds
only when that stage's `commit` is true. Under a `decisions` gate, where a stage says the human
approves at the gate, record what would be approved in the artifact and continue: stop only for a
decision, and every "stop and ask" below is one.

## diagnose — gate: always

1. Reproduce the bug with concrete evidence: the exact command or request, the actual result,
   and the expected result.
2. Find the root cause. List every suspect you considered and how you ruled it out.
3. Write the artifact with these sections: **Symptom**, **Reproduction**, **Evidence**,
   **Root cause**, **Ruled out**, **Affected areas**, **Proposed fix**.
4. Commit the artifact. At the gate, the human confirms the diagnosis before any fix is
   written.

If you cannot reproduce it, say so at the gate with what you tried. Do not fix a guess.

## fix — gate: always

1. Write the regression test first and run it against the unfixed code. It must fail, and fail
   for the reason in the root cause. Record that run in the artifact. A test that passes before
   the fix proves nothing: stop and rethink it.
2. Apply the smallest fix that addresses the root cause. Do not turn it into a refactor.
3. Run the regression test again, then the stage's checks. Add **Fix** and **Verification**
   sections to the artifact with the real results.
4. Commit. The gate is a code review.

## impact — gate: conditional

If the root cause shows that something outside this fix is wrong — a specification, the
documentation, another component — do not edit it here, and never edit what `never_edit`
lists. Open a follow-up task for each item and list them at the gate. With nothing to open,
continue to closing.
