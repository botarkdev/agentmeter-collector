---
name: taskrail-spike
description: Execute a taskrail task of kind spike — a time-boxed investigation that ends in a documented, reproducible decision rather than production code. Use when working a backlog task whose kind is spike, such as evaluating a tool, library or approach.
license: MIT
metadata:
  source: https://github.com/botarkdev/taskrail
---

# taskrail-spike

Follow the `taskrail` skill's procedure; this skill defines the stages. A spike produces a
decision, not code: write no production code, and keep any throwaway code outside the
repository or clearly marked as such.

The gate in each heading below is the core kind's default; follow the gate and the `commit` that
`taskrail show` reports for each stage, which a repository may change. "Commit" in a stage holds
only when that stage's `commit` is true. Under a `decisions` gate, where a stage says the human
approves at the gate, record what would be approved in the artifact and continue: stop only for a
decision, and every "stop and ask" below is one.

## frame — gate: always

Draft the artifact with: the **Question**; what **Evidence** would answer it; the
**Approach**; and the **Limits** — the time box and what the investigation will not cover.
Commit the draft, so it is not lost while the task waits. At the gate, the human agrees on the
question and the approach.

## investigate — gate: none

Gather evidence that someone else can reproduce. Record the exact commands, versions and
commits, and link primary sources. Prefer measuring to reasoning, and running the thing to
reading about it. Note anything you could not verify.

## decide — gate: always

Complete the artifact:

- **Verdict** — the first line of the document.
- **Question**.
- **Evidence** — measurements and findings, with sources.
- **Options considered**.
- **Recommendation**.
- **What would change the decision**.
- **How to reproduce**.

Commit it. At the gate, the human accepts or rejects the decision. Adopting it is follow-up
work: open tasks for it rather than doing it here.
