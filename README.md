# @agentmeter/collector

Reads a coding agent's local usage logs and reports them to agentmeter — without ever blocking or
failing the agent session that produced them.

Today it carries one adapter, for Claude Code: it scans the JSONL session transcripts Claude Code
already writes, normalises each assistant turn to agentmeter's ingestion contract, keeps on disk
whatever it could not deliver, and sends. See
[`specs/0019-claude-code-collector/`](specs/0019-claude-code-collector/) for what it does and
why it does it that way.

## The three things worth knowing before you use it

**It cannot fail your session.** `runCollector` never rejects and `agentmeter push` always exits 0
— for an unreachable service, an expired token, a corrupt transcript, an unwritable cache
directory, or a full disk. A run also has a wall-clock budget and abandons what it has not finished
rather than holding a session close open. Anything that went wrong is reported as data in the run's
outcome, which is the only channel it has.

**It sends metrics, never content.** Your transcripts contain your source, your prompts and
whatever you pasted into them. What leaves the machine is a fixed, declared set of fields: an
identifier, an instant, a session id, a model, a tier, and five token counts. Nothing derived from
message content, tool input or output, file contents, file paths, your working directory or your
git branch is transmitted — enforced by an allowlist projection and covered by a test that fails if
it stops holding, not by a promise in a comment.

**It reports the repository it runs in, and no other.** Your machine holds the transcripts of
every repository you work in, and one ingest token names one project. A run started in a
repository — at its root, in a subdirectory, or in one of its worktrees — reports that
repository's sessions and leaves the rest alone. It decides by where a session ran; that path is
read on your machine and never sent. See
[`specs/repository-scope/decision.md`](specs/repository-scope/decision.md), including what happens
to a repository's history when you move it.

It submits no attribution dimensions at all. Deriving one would mean reading a branch name or a
path, which is exactly what the paragraph above rules out; declaring attribution rules is a
separate, later piece of work.

## Install it

The package is published as a file attached to each
[release of this repository](https://github.com/botarkdev/agentmeter-collector/releases), not to a
package registry. Install a release by the address of its file, as a development dependency of the
repository whose usage you want reported:

```bash
pnpm add -D https://github.com/botarkdev/agentmeter-collector/releases/download/v0.2.0/agentmeter-collector-0.2.0.tgz
```

The file is already built: installing it compiles nothing, runs no script and pulls in no other
package. It needs Node.js 22 or later.

**With npm 12 or later, add `--allow-remote=all`**: `npm install -D --allow-remote=all <the same
address>`. From version 12 npm refuses, by default, a dependency that is not on a registry —
whether it is named by the address of a file or by a git repository (`allow-remote` and
`allow-git` both default to `none`). pnpm installs the address as given.

To upgrade, install the address of a later release. The version is part of the address, so a
lockfile pins exactly the file that was reviewed.

## Use it as a library

```ts
import { resolveConfigFromEnv, runCollector } from "@agentmeter/collector";

const outcome = await runCollector(resolveConfigFromEnv(process.env));
// outcome.status is "collected" or "not-configured"; outcome.failures says what went wrong.
```

## Use it from a hook

With the package installed in a repository, have Claude Code run it when a session ends:

```jsonc
// .claude/settings.json
{
  "hooks": {
    "SessionEnd": [
      { "hooks": [{ "type": "command", "command": "pnpm exec agentmeter push" }] }
    ]
  }
}
```

(`npx agentmeter push` with npm.) This file can be committed: it holds no value of any
environment. The endpoint and the token go where the next section says, never here.

The hook does nothing, and says so, on a machine where the two required variables are not set —
so a repository can commit it before every contributor has a token.

## Configuration

Every value comes from the environment, and none of them belongs in a committed file. For Claude
Code, the `env` block of the git-ignored `.claude/settings.local.json` is read at session start
and reaches the hook. Only the first two are required; without them
the collector does nothing, says so, and exits 0 — a hook fires in repositories that never opted
in.

| Variable | Default | Meaning |
| --- | --- | --- |
| `AGENTMETER_ENDPOINT` | — | Base URL of the agentmeter service. The collector appends `/api/v1/ingest`. |
| `AGENTMETER_TOKEN` | — | Ingest token, sent as `Authorization: Bearer`. Never written to disk, to stdout, or into a queued batch. |
| `AGENTMETER_PRICING_TIER` | `standard` | The pricing tier asserted on each measurement. The collector holds no price table and cannot compute this; the service treats it as the client's assertion. |
| `AGENTMETER_TRANSCRIPTS_DIR` | `~/.claude/projects` | Where Claude Code writes session transcripts. |
| `AGENTMETER_SCOPE` | `repository` | `repository` reports only the sessions of the repository the run was started in. `machine` reports every transcript under the directory above — use it only with a token whose project is meant to hold all of them. |
| `AGENTMETER_CACHE_DIR` | `$XDG_CACHE_HOME/agentmeter`, else `~/.cache/agentmeter` | Holds the queue of undelivered batches and the scan cursor. Both are disposable. |
| `AGENTMETER_MAX_BATCH_SIZE` | `200` | Measurements per request. |
| `AGENTMETER_MAX_QUEUED_BATCHES` | `512` | Ceiling on undelivered batches; the oldest are discarded first, and the discard is reported. |
| `AGENTMETER_RUN_BUDGET_MS` | `5000` | Total wall clock for one run. |
| `AGENTMETER_REQUEST_TIMEOUT_MS` | `2000` | Per-request timeout. |

A tuning variable that is not a positive integer falls back to its default and is reported as an
`invalid-setting` failure naming the variable — never its value. A typo must not be the reason
metrics stop being collected, and must not be silent either.

## What it puts on your disk

Under `AGENTMETER_CACHE_DIR`, and safe to delete at any time. Each repository has a directory of
its own there, `repositories/<digest>/`, named by a digest of the repository's path rather than by
the path; a run with `AGENTMETER_SCOPE=machine` uses the cache directory itself. They are kept
apart because a queued batch holds no token: shared, one repository's undelivered usage would be
sent under another's. Each holds:

- `queue/` — one file per undelivered batch, written and renamed atomically. Each holds exactly
  the request body that will be sent: no token, no endpoint. That is what lets a rotated token or
  a moved endpoint recover the backlog rather than strand it.
- `scan-cursor.json` — how far each transcript has been read. **This is an optimisation and
  nothing about correctness depends on it.** Delete it and the next run re-reads everything and
  resubmits; the service deduplicates, and the only difference is how long the run takes.

Transcripts themselves are opened read-only and never modified.

## Commands

Run from the repository root.

| Command | What it does |
| --- | --- |
| `pnpm build` | Compiles to `dist/`, which is what the package ships and the `agentmeter` binary runs from. |
| `pnpm check:package` | Packs the build as a release does, installs the file into an empty project with no network, and runs the installed binary. |
| `pnpm test:unit` | Runs `*.unit.test.ts`. No network, and nothing outside a temporary directory. |
| `pnpm test:cov` | Runs the unit suite with coverage; fails below the declared 80% threshold. |
| `pnpm typecheck` | Type-checks sources and tests. |
| `pnpm format:check` | Fails on a file Prettier would rewrite; `pnpm format` rewrites it. |

## Public surface

`runCollector`, `resolveConfigFromEnv`, `runCli`, `summarise`, the `RunOutcome` family of types,
and the ingestion contract types. The scanning, queueing and transport internals are not part of
this package's contract and may change without notice.
