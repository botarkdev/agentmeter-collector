# C008 — Say in CLAUDE.md that a rule file can withhold or hash a key

## Goal

C003 changed what a repository's `.agentmeter.json` may declare and what then leaves the machine:
a key can now be sent plain, as a salted digest, or not at all, and a version 2 file also carries
a salt. Three statements of `CLAUDE.md` stopped being true with it, and `Key documents` never
gained the new decision record. This task brings those four places in line, applying the text the
owner approved; it edits `CLAUDE.md` and nothing of the behaviour, which C003 already shipped.

## Change set

Only documentation changes. The replacement text is the owner-approved text proposed in
`docs/features/C003-privacy-controls-over-attribution.md`, section "Proposed text for
`CLAUDE.md`", copied verbatim (not reworded).

| File | Change |
| --- | --- |
| `CLAUDE.md`, rule 2 | After "Those two sources are a closed set.", the sentence that a version 2 file says on every entry whether its key is sent as built, as a salted digest, or not at all, with no default, applied in `src/attribution/` before a dimension exists. |
| `CLAUDE.md`, Key documents | A new entry for [`specs/attribution-privacy/decision.md`](../../specs/attribution-privacy/decision.md), after the attribution-rules entry. |
| `CLAUDE.md`, Configuration | The sentence that `.agentmeter.json` "holds attribution rules and nothing else … because a later key may say a dimension is to be withheld" is replaced: the file also holds how each key is sent and the salt of the keys sent hashed; the salt is not a credential; and a version 2 entry that does not say how its key is sent invalidates the file. |
| `CLAUDE.md`, Not here yet | "Nor privacy controls over attribution … or a second agent adapter (`C004`)." becomes "Nor a second agent adapter (`TASKRAIL.md` row `C004`)." — the privacy controls are no longer pending. |
| `docs/chores/C008-…md`, `docs/chores/README.md` | This record and its index row. |
| `TASKRAIL.md` | Row C008, by `taskrail done` only. |

Not changed: anything under `src/` or `test/`, `package.json`, `pnpm-lock.yaml`, `specs/`, the
workflows, C007 (left pending for the owner).

## Decisions needed

None open. The owner approved the four replacement paragraphs on 2026-10-11 ("C008: ok,
aplícalo."), which is what unblocks editing `CLAUDE.md`. The one wording caveat the C003 record
flags is already settled in the approved text: the built names are `hashSalt` /
`invalid-hash-salt`, and the approved CLAUDE.md text speaks of "a salted digest" and "the salt",
consistent with the code.

## Out of scope

- C007 (the Apache-2.0 licence paragraph and the `pnpm build` row): left unclaimed and pending;
  its verbatim approved text is not committed anywhere, so it was not applied.
- The behaviour itself, which C003 shipped.

## Verification

Each approved anchor was confirmed to match `CLAUDE.md` byte-for-byte before editing, and each
fact the text asserts was checked against the tree: `specs/attribution-privacy/decision.md`
exists; the hash treatment lives in `src/attribution/` (`hashSalt` / `invalid-hash-salt` in
`src/attribution/attribution-rules.ts`); `TASKRAIL.md` row `C004` is the second agent adapter.
`CLAUDE.md` was grepped for literal invisible characters after editing — none; only the em-dashes
and ellipsis the file already uses.

### Results (2026-10-11)

- `pnpm format:check` — "All matched files use Prettier code style!" (it covers `ts/js/json`;
  `CLAUDE.md` is Markdown and is not reformatted).
- `pnpm typecheck` — clean.
- `pnpm test:cov` — passed: 98.99% statements, 98.11% branches, 99.13% functions, 99.09% lines,
  all above the 80% threshold.
- `pnpm build` — clean.
- `pnpm check:package` — `ok — agentmeter-collector-0.3.0.tgz, 42 files`.
