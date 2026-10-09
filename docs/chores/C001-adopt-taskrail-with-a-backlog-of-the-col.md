# C001 — Adopt taskrail with a backlog of the collector's own

## Goal

The collector left the service's repository (`botarkdev/agentmeter`) with three tasks still open
in that repository's backlog and no backlog of its own. This task gives it one: a
[taskrail](https://github.com/botarkdev/taskrail) backlog in `TASKRAIL.md`, the tool pinned and
configured for this repository's checks, and the open work recreated in it.

The change set was proposed and approved in the service's repository, as the task there that
moved the three rows; this document is the record of it here.

## Change set

| File | Change |
| --- | --- |
| `.taskrail/config.toml` | New. Written by `taskrail init --integration claude` (v0.4.0), then edited: see "The configuration". |
| `.taskrail/bin/taskrail`, `.taskrail/installed.json` | New, as `init` wrote them. The wrapper runs the pinned release: an installed CLI of that version, otherwise that version through `uvx`. |
| `.claude/skills/taskrail/`, `taskrail-bug/`, `taskrail-chore/`, `taskrail-feature/`, `taskrail-spike/`, `taskrail-autopilot/` | New, as `init` wrote them: taskrail's own skill texts, nine files, each marked MIT with its source. Not edited. |
| `TASKRAIL.md` | New: a preamble, two epics, five tasks. |
| `docs/backlog/C005-service-contract-check.md` | New: the detail of row C005, too long for a row. |
| `.prettierignore` | `.taskrail/installed.json` added. |
| `scripts/check-package.mjs` | Four forbidden prefixes added: `package/docs/`, `package/.taskrail/`, `package/.claude/`, `package/TASKRAIL.md`. |
| `CLAUDE.md` | Four edits: the backlog exists and where it is; a "Backlog" paragraph; `C###` against the service's `T###`; the commit example's task ID. |

Not changed: `src/`, `test/`, `specs/`, `package.json`, `pnpm-lock.yaml`, both workflows,
`README.md`, `CHANGELOG.md`, `LICENSE`.

## The configuration

What differs from what `init` seeds, and why:

- **`version = "v0.4.0"`**, as seeded. The repository is public, so it must be workable by someone
  who has only `uv`: the wrapper fetches exactly that release from taskrail's public repository.
- **`prefix = "C"`**. Comments in `src/` and the design record under
  `specs/0019-claude-code-collector/` name rows of the service's backlog as `T###`. With the
  default prefix this backlog would one day allocate its own `T013`, and a comment that says
  "row T013" would point at the wrong task. A `T###` here is always the service's.
- **`mainline = "main"`**. `init` seeds the branch it was run on.
- **No custom column and no restriction on kinds.** The service's backlog routes its `spec` tasks
  through a `Spec` column to a specification pipeline this repository does not have. Here the four
  core kinds apply: `feature`, `bug`, `chore`, `spike`.
- **`[checks]`** — the five steps of `.github/workflows/tests.yml`, under the two names the core
  kinds' stages run: `test` is `pnpm test:cov && pnpm build && pnpm check:package`, `lint` is
  `pnpm format:check && pnpm typecheck`. A task's checks are therefore what a pull request must
  pass.
- **`[autopilot]`** — enabled; `governing` names `LICENSE` and the design record, the two things
  `CLAUDE.md` says no agent changes; `notify` is the notification script this repository already
  carries.

Not used: `init`'s `--github-workflow`, `--pre-commit` and `--merge-driver`.

## The backlog

- **E01 — Collectors** holds what was open in the service's backlog: C002 (there T013), C003
  (T030) and C004 (T014), each corrected for what changed since its row was written — the
  endpoint is never in a committed file; the repository scope
  (`specs/repository-scope/decision.md`) already decides which sessions are reported and is
  selection, not attribution; a dimension is a new field on the wire, which rule 2 makes the
  owner's decision.
- **E02 — Repository and contract** holds this task and C005, the collector's half of the
  contract the service now pins.

C002 and C005 depend on this task, and C003 and C004 on C002. Until this branch is merged, that
dependency is also what gives them a base: taskrail starts a task whose dependency is finished on
an unmerged branch from that branch.

## Decisions needed

None open. Each choice above was approved before anything was edited.

## Out of scope

- The licence, and publication to a package registry: both are still the owner's open decisions.
- Working any of C002 to C005.

## Verification

Run in this task's worktree, on the branch, at the commit before this document.

- `taskrail validate`: `5 task(s) in 1 backlog(s): 0 error(s), 0 warning(s)`.
- `taskrail kind list`: `bug`, `chore`, `feature`, `spike`.
- `pnpm format:check` failed on `.taskrail/installed.json` before the `.prettierignore` entry and
  passes with it: `All matched files use Prettier code style!`
- `pnpm typecheck`: no output, exit 0.
- `pnpm test:cov`: 17 files, 245 tests passed; statements 98.67%, branches 98.34%, functions
  98.71%, lines 98.84%.
- `pnpm build`, then `pnpm check:package`: `check-package: ok — agentmeter-collector-0.2.0.tgz,
  39 files` — the same 39 as before the install.
- The guard, exercised: with `TASKRAIL.md`, `.taskrail`, `.claude` and `docs` added to `files` in
  `package.json`, `pnpm check:package` exits 1 and names each of the fourteen files as "the
  package ships …"; with `package.json` restored it passes again.
- `taskrail checks C001`: `test` passed, `lint` passed.
- Nothing the install wrote names a person, a machine, a private host or a token: the only
  addresses in it are taskrail's public repository.
