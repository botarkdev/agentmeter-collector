# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

**agentmeter-collector** — the client side of agentmeter. It reads the usage logs a coding agent
already writes on the developer's machine and reports token counts to the agentmeter service. Today
it carries one adapter, for Claude Code: it scans the JSONL session transcripts under
`~/.claude/projects/`, normalises each assistant turn to the service's ingestion contract, keeps on
disk whatever it could not deliver, and sends.

This repository is **public on purpose**. The collector opens files that hold a developer's
source, prompts and pasted secrets, so anyone must be able to read exactly what leaves the
machine. Treat every line here as published: no secret, no private hostname, no real token, no
real transcript content — not in code, a fixture, a comment, a commit message or a test name.

It lived in the service's monorepo as `packages/collector` until 2026-10-08 and was moved here with
its history. The service is `botarkdev/agentmeter` (private).

## The four things that must stay true

These are the reason the collector is built the way it is. A change that weakens one is not a
refactor; say so and stop.

1. **It can never fail or block an agent session.** `runCollector` never rejects and
   `agentmeter push` always exits 0 — for an unreachable service, an expired token, a corrupt
   transcript, an unwritable cache directory, a full disk. A run has a wall-clock budget and
   abandons what it has not finished. Whatever went wrong is reported as data in the run's
   outcome, which is the only channel it has.
2. **It sends metrics, never content.** What leaves the machine is a fixed, declared set of fields:
   an identifier, an instant, a session id, a model, a tier and five token counts. Nothing derived
   from message content, tool input or output, file contents, file paths, the working directory or
   the git branch is transmitted. This is enforced by an allowlist projection
   (`src/contract/measurement-projection.ts`) and by a test that fails when it stops holding
   (`test/unit/contract/content-safety.unit.test.ts`), never by a promise in a comment. A new field
   on the wire is a decision for the owner, not an implementation detail. Reading a path to
   decide which turns to report is allowed and is what the scope does; carrying one anywhere past
   `src/claude-code/usage-extraction.ts` is not.
3. **It has zero runtime dependencies.** `package.json` has no `dependencies` and gains none: a
   hook that runs at the end of every session must install nothing and audit to nothing. Node's
   built-ins only. Development dependencies are pinned to exact versions.
4. **The service is the authority on the contract.** The collector defines the TypeScript shape of
   the payload it builds and re-validates nothing; `POST /api/v1/ingest` on the service decides
   what is valid. The collector sends no project and no user identity — both are the service's to
   derive from the token. The service does not know what a "spec" or a "task" is, and nothing here
   should teach it.

## Key documents

- [`README.md`](README.md) — what a user of the collector needs: configuration, what it writes to
  disk, the public surface.
- [`specs/repository-scope/decision.md`](specs/repository-scope/decision.md) — why a run reports
  only the repository it was started in, how it decides which turns those are, and why the queue
  and the cursor are per repository. It reverses one decision of the record below.
- [`specs/0019-claude-code-collector/`](specs/0019-claude-code-collector/) — the design record:
  the spec, the research decisions, and the two contracts (`contracts/ingest-submission.md`,
  `contracts/run-outcome.md`). Read `research.md` before changing how scanning, queueing or
  sending works; most "why is it like this" questions are answered there. **It is a record of
  what was decided when the collector was built inside the service's repository, and it is not
  edited.** A new decision is written as a new document beside it.

**References that point outside this repository.** Comments in `src/` and `test/`, and the design
record, name things that live in the service's repository: `TASKRAIL.md` rows (`T013`, `T030`,
`T104`, …), "the Constitution", and paths under `apps/api/`. They are that repository's. Do not
go looking for them here, and do not delete the comments: they still say why the code is the way
it is. When a comment you are already editing carries one, say what it meant in words instead.

## Working here

**Layout**: a single package, not a workspace. `pnpm-workspace.yaml` exists for pnpm's settings
only.

| Path | What it holds |
| --- | --- |
| `src/claude-code/` | The Claude Code adapter: finding transcripts, reading them, extracting usage. The only part that knows a transcript's format. |
| `src/contract/` | The wire shape and the allowlist projection that builds it. |
| `src/scope/` | Which repository a run belongs to, and which turns belong to that repository. Reads paths to decide; sends none. |
| `src/queue/`, `src/cursor/` | The on-disk queue of undelivered batches and the scan cursor, one of each per repository. Both are disposable by design. |
| `src/transport/` | The one HTTP call. |
| `src/run/` | One run, end to end, and its outcome. |
| `src/config/` | Configuration from the environment. |
| `src/cli/` | The `agentmeter` binary. `agentmeter.ts` is the bootstrap file and is not tested; everything it does lives in `run-cli.ts`. |
| `src/index.ts` | The public surface. Anything not exported there may change without notice. |
| `test/unit/` | Mirrors `src/`. |

**Commands**, from the repository root:

| Command | What it does |
| --- | --- |
| `pnpm install` | Installs the development dependencies. No manual step follows — the one build-script approval is committed in `pnpm-workspace.yaml`. |
| `pnpm test:unit` | Every `*.unit.test.ts`. No network, and nothing outside a temporary directory. |
| `pnpm test:cov` | The same, with coverage; fails below 80% lines, statements, functions or branches. |
| `pnpm typecheck` | Type-checks sources and tests. |
| `pnpm format:check` | Fails on a file Prettier would rewrite. `pnpm format` rewrites it. |
| `pnpm build` | Removes `dist/` and compiles `src/` into it. `dist/` is the whole package: `package.json` ships nothing else. |
| `pnpm check:package` | After a build: packs the collector as a release does, checks what is and is not in the file, installs it into an empty project with no network and runs the installed binary. The only check on the artefact — the unit suite imports `src/` and cannot see a package that ships without its binary. |

**Tests**: unit tests only, every dependency injected and mocked, no network, no file outside a
temporary directory. A behaviour is tested through the public function that has it, and a bug is
fixed under a test that was seen failing first. Coverage is exclusion-based — everything under
`src/` is measured unless `vitest.unit.config.ts` names it — and the threshold is not lowered to
make a change pass.

**Configuration**: every value comes from the environment (`README.md`, "Configuration"). No
endpoint, token, host or port is committed to any file, as a default or as an example that could
be mistaken for one. A tuning variable that is not valid falls back to its default and is reported
as an `invalid-setting` failure naming the variable, never its value.

**CI**: `.github/workflows/tests.yml` — formatting, types, the unit suite under coverage, the
build and the packed artefact — on every pull request and every push to `main`. It holds no write
permission and no schedule; keep it that way.

**Releasing**: `.github/workflows/release.yml`, started by a pushed tag `v<version>` and by
nothing else. It fails unless the tag names the version in `package.json`, runs every check
`tests.yml` runs, and publishes the packed package twice: as a file attached to a GitHub release,
and as a tree — one commit on the `dist` branch, tagged `dist-v<version>` — for installing
straight from git (`README.md`, "Install it"). **`dist` is written by that workflow and by
nothing else**: never commit to it, never force it, never merge it anywhere; its tree is
`scripts/write-dist-tree.mjs`'s output, the package with a manifest stripped of `scripts` and
`devDependencies`. Nothing is published to a package registry. A release
is: a pull request that raises `version` in `package.json` and moves the changelog's
`[Unreleased]` entries under the new version, merged; then the tag, on that merge. **Pushing the
tag is the owner's**, like every other write to GitHub. `0.x`: a breaking change raises the minor
version.

**Not here yet**: publication to a package registry — the package stays `private` so that it
cannot be published to one by accident, and its name is not settled (`@agentmeter/collector` is a
scope nobody has registered). Nor attribution rules a repository declares, privacy controls, or a
second agent adapter. There is no backlog file in this repository yet.

**The licence is the owner's open decision.** `LICENSE` is the proprietary notice the code
carried in the service's repository: it grants nobody permission to use it. That is at odds with
a public collector people are meant to install, and it must be settled before the package is
published. Do not choose a licence yourself.

## Language

Everything written to this repository is in English: code, comments, documentation, configuration
names and values, commit messages. Only the conversation with the owner may be in Spanish.

## Commits and pull requests

- Commits follow Conventional Commits: `type(scope): description`, with the affected module as
  scope (`claude-code`, `contract`, `queue`, `cursor`, `transport`, `run`, `config`, `cli`, or
  `repo` for tooling and documentation). When a task id exists it leads the scope:
  `fix(T012:queue): …`.
- A commit message is its subject line and nothing else, by default. A body is written only for
  what neither the subject nor the diff conveys, in one or two lines. Co-authorship trailers are
  exempt.
- Work on a branch, never on `main`. Pull requests are squash-merged, so **the pull request title
  is the commit that reaches `main`**: it must be a Conventional Commits subject, and the type
  must be honest — `feat` and `fix` are what a future release will read to decide a version.

## Working with the repository owner

- **Chat replies stay short.** Answer in a few lines, without analogies or pre-emptive
  justification. Written deliverables are as thorough as they need to be; this is about the
  conversation.
- **GitHub is the owner's to write to.** Opening or merging a pull request, re-running a job,
  deleting a branch on GitHub, changing a repository setting: hand it over, never assume it. No
  read-only `gh` token is set up for this repository; do not call `gh` and do not look for another
  way in.
- **Hand over the exact pull request title with every branch**, together with the prefilled
  compare link:
  `https://github.com/botarkdev/agentmeter-collector/compare/main...<branch>?expand=1&title=<title>`,
  the title encoded with `encodeURIComponent`, never by hand.
- **Notify on Telegram in exactly two cases**, with `node scripts/telegram-notify.mjs "<message>"`
  (or the message on stdin): a branch is ready for review and merge, and the owner has left a
  question unanswered for more than five minutes. Never for ordinary progress or an ordinary
  failure. A ready-branch message carries the branch name, the pull request title and the
  prefilled compare link: the owner acts from another device, and a message without the link is
  not actionable. Plain text, short — Telegram rejects more than 4096 characters and the script
  swallows the rejection.
  **The credentials are the owner's to set and never the agent's to handle**: `TELEGRAM_BOT_TOKEN`,
  `TELEGRAM_CHAT_ID` and, for a topic of a forum group, `TELEGRAM_TOPIC_ID`, in the `env` block of
  the git-ignored `.claude/settings.local.json`, read at session start. Never read that block,
  never pass a token as an argument, never call `curl` with it. `--status` says which are set and
  nothing else. **The script's silence is not proof of delivery**: it exits 0 on unset
  configuration, a non-2xx response and a network error alike, so a wrong chat or topic id looks
  like success — to diagnose one, POST from a throwaway script that reads the token from the
  environment and prints only `ok`, `error_code` and `description`.
  The script is copied byte for byte from the owner's genki repository and is not edited or
  reformatted here (it is in `.prettierignore`). It is a developer tool: it is not part of the
  package, and nothing under `src/` may import it.
- **Say when a branch is ready without being asked**, and verify a merge landed by content before
  deleting anything: a squash merge breaks ancestry, so `git branch --merged` and `git merge-base`
  both lie.
