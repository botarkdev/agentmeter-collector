# C006 — autopilot decisions

Decisions the orchestrator took on the human's behalf while this task ran in an autopilot lane
(run 20261009-1, extended with this task). The owner decided on 2026-10-09 that the collector is
licensed under Apache-2.0; everything below is how that is carried out, not whether.

## scope gate

Reviewed: the artifact at `b653b66` as the lane reported it, with the licence text's source and
its sha256, the three copies under `node_modules` that differ from it, and every sentence in the
repository that mentions the licence.

| # | Question | Options | Decision | Reason |
|---|---|---|---|---|
| 1 | A `NOTICE` file? | add it and ship it · no file, the holder in the README only · fill in the licence's appendix | as recommended: **add it**, first line `agentmeter-collector` | `LICENSE` stays the unmodified text and so names nobody; the notice is where the licence itself puts attribution, and it travels with every copy. The holder is the one the previous file named. |
| 2 | Licence headers in source files? | none · one per file | as recommended: **none** | None exist, none is required. |
| 3 | The README's wording | as proposed · other | **as proposed** | |
| 4 | A dated note in the one historical sentence that says the licence is "still" open | add · leave | as recommended: **add** | |
| 5 | Does the package check also assert the `dist` tree's licence? | yes · the packed file only | as recommended: **yes** | Nothing else checks what people actually install. |
| 6 | A changelog entry? | yes · no | as recommended: **yes** | |

For the owner: `CLAUDE.md` says the licence is an open decision and is not edited by this task;
the replacement paragraph is proposed to them. The release already published keeps the previous
notice until the next release is cut.
