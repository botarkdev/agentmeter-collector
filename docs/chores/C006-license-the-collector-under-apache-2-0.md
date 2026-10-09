# C006 — License the collector under Apache-2.0

## Goal

`LICENSE` is the proprietary notice the code carried in the service's repository: it grants nobody
permission to use a package that `README.md` tells people to install, and `package.json` declares
no licence at all. The owner decided on 2026-10-09 that the collector is licensed under
Apache-2.0. This task makes the repository say so, in the four places a reader or a tool looks —
`LICENSE`, `package.json`, `README.md` and the published file — and adds a check that fails when
they stop agreeing.

The copyright holder is the one the current `LICENSE` names, Alexander Rondon, and the year is the
one it gives, 2026. Nothing else about the holder is introduced.

## What was found

- **The licence text.** Fetched from `https://www.apache.org/licenses/LICENSE-2.0.txt` on
  2026-10-09: 11358 bytes, 202 lines, ASCII, LF line endings, SHA-256
  `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`.
- **No installed dependency carries that exact text**, so none can serve as the reference copy.
  Three packages under `node_modules` ship an Apache-2.0 licence file, and `diff` against the
  fetched text shows each departs from it: `typescript@5.9.3` (`LICENSE.txt`, 9197 bytes, 55
  lines — reflowed, no appendix), `expect-type@1.4.0` (10760 bytes — a copyright notice prepended,
  no appendix) and `detect-libc@2.1.2` (11357 bytes — the leading blank line dropped and the
  appendix's `[]` placeholders written as `{}`; three differing lines in all). The fetched file is
  therefore the reference, and its SHA-256 above is what the check pins.
- **`LICENSE` already ships.** `scripts/check-package.mjs` lists `package/LICENSE` among the
  required entries, and the packer includes a root `LICENSE` whatever `files` says. A root
  `NOTICE` is not included that way: it ships only if `files` names it.
- **The `dist` branch needs no change of its own.** `scripts/write-dist-tree.mjs` unpacks the
  release file whole and removes only `scripts`, `devDependencies` and `packageManager` from the
  manifest, so whatever the release file carries — `LICENSE`, `NOTICE`, the `license` field — the
  tree carries too. Nothing checks that today.
- **No source file carries a copyright or licence header** (`git grep -i copyright` finds only
  `LICENSE`).
- **Sentences that describe the licence**, from
  `git grep -n -i -E "licen[sc]|proprietary|all rights reserved|copyright"` outside
  `.claude/skills` and the lockfile:

  | Where | What it says | What happens to it |
  | --- | --- | --- |
  | `LICENSE` | The proprietary notice. | Replaced. |
  | `CLAUDE.md`, "The licence is the owner's open decision…" | That no licence is chosen and none may be. | False once this lands. Not edited by this task: the replacement text is proposed to the owner. |
  | `docs/chores/C001-…md`, "Out of scope" | "The licence, and publication to a package registry: both are still the owner's open decisions." | A record of 2026-10-08, true when written; "still" would mislead a later reader. One dated note is added after it; the sentence itself is not rewritten. |
  | `docs/chores/C001-…md`, "The configuration" | That `governing` names `LICENSE`, one of "the two things `CLAUDE.md` says no agent changes". | Left: it describes the configuration, which does not change. |
  | `.taskrail/config.toml`, `governing` | Names `LICENSE`. | Left: the file stays one a lane escalates over. |
  | `docs/chores/C001-…md`, `docs/chores/C005-…md`, `docs/features/C002-…md` | "Not changed: … `LICENSE`". | Left: each is a statement about that task's own change set. |
  | `specs/0019-claude-code-collector/spec.md` | "proprietary source" — about a developer's transcripts, not this repository. | Left. |
  | `TASKRAIL.md`, row C006 | This task. | Status only, by `taskrail done`. |

## Change set

| File | Change |
| --- | --- |
| `LICENSE` | Replaced by the Apache License, Version 2.0: the fetched file's bytes, unmodified — including its appendix with the `[yyyy] [name of copyright owner]` placeholders, which are part of the text and are not filled in. |
| `NOTICE` | New, **if decision 1 is approved**: two lines, the package's name and `Copyright 2026 Alexander Rondon`. |
| `package.json` | `"license": "Apache-2.0"` added. `"NOTICE"` added to `files` if decision 1 is approved. `version` is not raised; no other field changes. |
| `scripts/check-package.mjs` | Extended: see "The check". |
| `README.md` | A final section, "Licence": see decision 3. |
| `CHANGELOG.md` | One entry under `[Unreleased]`, "Changed": the package is licensed under Apache-2.0, where it carried a notice that granted no permission. |
| `docs/chores/C001-adopt-taskrail-with-a-backlog-of-the-col.md` | One dated note after the "Out of scope" sentence: the licence was decided on 2026-10-09, see C006. |
| `docs/chores/C006-license-the-collector-under-apache-2-0.md`, `docs/chores/README.md` | This document and its index row. |
| `TASKRAIL.md` | Row C006, by `taskrail done` only. |

Not changed: `CLAUDE.md` (see "Out of scope"), anything under `src/` or `test/`, `specs/`,
`pnpm-lock.yaml`, both workflows, `scripts/write-dist-tree.mjs`, `.taskrail/config.toml`,
`docs/autopilot/decisions/`, the package's version, the `dist` branch.

### The check

`pnpm check:package` is the repository's one check on the artefact, a step of both workflows and
part of this repository's `test` check, so the new assertions go there and nowhere else. It
already packs the release file and installs it into an empty project. It gains:

1. A table of the licences this package may declare — one row, `Apache-2.0` and the SHA-256 of
   its canonical text — and the failure "the manifest declares no licence this check knows" when
   the packed manifest's `license` is not a key of it.
2. The packed `LICENSE`, read from the installed package, hashed and compared with the row its
   manifest's `license` names. This is what fails when the field and the text disagree, and
   equally when the text is edited, reflowed or re-encoded.
3. `package/NOTICE` among the required entries, and the installed `NOTICE` naming the copyright
   holder (if decision 1 is approved).
4. The `dist` tree: `scripts/write-dist-tree.mjs` is run on the same file into the check's
   temporary directory, and the resulting tree must hold `LICENSE` with the same hash, `NOTICE`,
   and a manifest whose `license` is unchanged. The script is run, not edited.

No unit test is added: the unit suite imports `src/` and reads no packed file, and a second copy
of the hash in a test would be a second place to keep it.

## Decisions needed

All four were answered at the scope gate on 2026-10-09 as recommended: `NOTICE` is added and
shipped, its first line `agentmeter-collector`; no source file gains a header; the README's
wording is the one proposed; C001's record gains the dated note. The `dist` tree assertion and the
changelog entry of the change set were approved with them.

1. **A `NOTICE` file?** Apache-2.0 does not require one. Because `LICENSE` is the unmodified
   text, it names no copyright holder; the holder has to be stated somewhere.
   - (a) **Add `NOTICE`** — `agentmeter-collector` / `Copyright 2026 Alexander Rondon` — and ship
     it. It is the place the licence itself designates (section 4(d)): whoever redistributes the
     package must carry it, so the attribution travels with every copy. Cost: one more file in
     the package and one more thing redistributors must keep. **Recommended.**
   - (b) No `NOTICE`; the holder is stated in `README.md` only. Fewer files, but the README is
     not something the licence obliges anyone to keep.
   - (c) Fill the appendix's placeholders in `LICENSE`. Rejected: the file would no longer be the
     unmodified text, and its hash would match no published copy.
2. **SPDX or copyright headers in source files?** No file has one today. **Recommended: none.**
   The licence does not require them, `LICENSE` and the manifest cover the package, and adding
   them touches every file under `src/` for no change in anyone's rights.
3. **The README's wording.** Proposed, as the last section:

   > ## Licence
   >
   > Apache License, Version 2.0 — see [`LICENSE`](LICENSE). Copyright 2026 Alexander Rondon
   > ([`NOTICE`](NOTICE)).

   Without `NOTICE`, the parenthesis is dropped. The heading is spelled "Licence", as the
   repository's prose spells the noun; the file and the manifest field keep their fixed names.
4. **The dated note in C001's document** (see the table above): add it, or leave the record
   untouched? **Recommended: add it** — it is the one historical sentence that says "still".

## Out of scope

- **`CLAUDE.md`.** Its paragraph "The licence is the owner's open decision…" becomes false, and
  its `pnpm build` row ("`dist/` is the whole package: `package.json` ships nothing else") is
  loose once `files` names `NOTICE`. This task does not edit that file; both are reported with
  proposed replacements for the owner.
- Raising the version, and the release that would publish the licensed package: the owner's call.
  The already published `v0.2.0` release file and `dist-v0.2.0` tree keep the old notice.
- The `dist` branch, publication to a package registry, the package's name, an `author` field.
- `.taskrail/config.toml`'s `governing` list (whether it should also name `NOTICE`).

## Verification

- `diff` of the committed `LICENSE` against the fetched file, and its SHA-256.
- `pnpm build` and `pnpm check:package` passing, and the packed file's entry list showing
  `package/LICENSE` (and `package/NOTICE`).
- The new assertions seen failing, each by a temporary edit that is then undone: `license` set to
  another identifier; one byte of `LICENSE` changed; `NOTICE` taken out of `files`.
- `.taskrail/bin/taskrail checks C006`: the `test` and `lint` checks, which are the five steps of
  `tests.yml`.

### Results (2026-10-09)

- **The text.** Fetched again before writing it: HTTP 200, 11358 bytes, the same SHA-256.
  `cmp LICENSE <fetched file>` reports no difference; `sha256sum LICENSE` gives
  `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`.
- **The packed file** (`pnpm pack`, 42 entries): the 38 files under `package/dist/`, and
  `package/LICENSE`, `package/NOTICE`, `package/package.json`, `package/README.md`. The packed
  `LICENSE` has the SHA-256 above; the packed manifest declares `"license": "Apache-2.0"`.
- **The `dist` tree** (`scripts/write-dist-tree.mjs` on that file): `dist`, `LICENSE`, `NOTICE`,
  `package.json`, `README.md`; the same hash and the same `license` field.
- **Each new assertion was seen failing**, by a temporary edit undone afterwards, with
  `node scripts/check-package.mjs` exiting 1 each time:

  | Temporary edit | What the check printed (for the installed package and again for the dist tree) |
  | --- | --- |
  | `license` set to `MIT` | `declares "MIT", which is no licence this check knows the text of` |
  | `license` removed | `declares undefined, which is no licence this check knows the text of` |
  | One letter of `LICENSE` changed | `LICENSE is not the published text of Apache-2.0` |
  | `LICENSE` replaced by the variant `detect-libc` ships | `LICENSE is not the published text of Apache-2.0` |
  | `NOTICE` taken out of `files` | `the package is missing package/NOTICE`, then `has no NOTICE` twice |
  | `NOTICE` naming another holder | `NOTICE does not carry the line "Copyright 2026 Alexander Rondon"` |

  This also settles what the scope stage only inferred: the packer does not include a root
  `NOTICE` by itself — `files` must name it.
- **`.taskrail/bin/taskrail checks C006`**: `passed test`, `passed lint` — 19 test files, 406
  tests, coverage 98.95% statements / 97.95% branches / 99.09% functions / 99.05% lines;
  `check-package: ok — agentmeter-collector-0.2.0.tgz, 42 files`; "All matched files use Prettier
  code style!"; the type check clean.

## Documentation

`README.md` and `CHANGELOG.md` are part of the change set above. The one document left that
describes the licence is `CLAUDE.md`, which this task does not edit: its paragraph "The licence is
the owner's open decision…" is false from this change on, and its replacement is with the owner.
No follow-up task is opened.
