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
message content, tool input or output, file contents, file paths, your working directory or a
session's name is transmitted — enforced by an allowlist projection and covered by a test that
fails if it stops holding, not by a promise in a comment.

**One more field is sent only if your repository asks for it.** A repository that commits
attribution rules has a seventh field, `dimensions`, sent with each measurement: what those rules
capture of a branch name, or of a name you declared in `AGENTMETER_SOURCE`. Without that file
nothing about your branch is read. See [Attribution](#attribution).

**It reports the repository it runs in, and no other.** Your machine holds the transcripts of
every repository you work in, and one ingest token names one project. A run started in a
repository — at its root, in a subdirectory, or in one of its worktrees — reports that
repository's sessions and leaves the rest alone. It decides by where a session ran; that path is
read on your machine and never sent. See
[`specs/repository-scope/decision.md`](specs/repository-scope/decision.md), including what happens
to a repository's history when you move it.

## Install it

The package is not on a package registry. Each
[release of this repository](https://github.com/botarkdev/agentmeter-collector/releases) publishes
it two ways, and either installs it as a development dependency of the repository whose usage you
want reported.

**From this repository, by tag.** Every release `v<version>` has a tag `dist-v<version>` whose tree
is the built package:

```bash
pnpm add -D github:botarkdev/agentmeter-collector#dist-v0.3.0
npm install -D --allow-git=all github:botarkdev/agentmeter-collector#dist-v0.3.0
```

Name the `dist-` tag, never `v0.3.0` or `main`: those hold the sources, and a package manager
installing from git builds nothing.

**By the address of the release's file:**

```bash
pnpm add -D https://github.com/botarkdev/agentmeter-collector/releases/download/v0.3.0/agentmeter-collector-0.3.0.tgz
npm install -D --allow-remote=all https://github.com/botarkdev/agentmeter-collector/releases/download/v0.3.0/agentmeter-collector-0.3.0.tgz
```

Either way the package is already built: installing it compiles nothing, runs no script and pulls
in no other package. It needs Node.js 22 or later.

**The npm flags are npm 12's.** From version 12 npm refuses, by default, a dependency that is not
on a registry, whether it is named by a git repository or by the address of a file (`allow-git`
and `allow-remote` both default to `none`); the flag on the command line, or the same setting in
the repository's `.npmrc`, allows it. pnpm installs both as given.

To upgrade, install a later release's tag or address. The version is part of both, so a lockfile
pins exactly what was reviewed.

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
| `AGENTMETER_SOURCE` | — | A name you choose for where these metrics come from, such as one per checkout. It is sent only if the repository's committed attribution rules have a `source` rule that accepts it; by itself it does nothing. At most 255 characters, no control characters. See [Attribution](#attribution). |
| `AGENTMETER_CACHE_DIR` | `$XDG_CACHE_HOME/agentmeter`, else `~/.cache/agentmeter` | Holds the queue of undelivered batches and the scan cursor. Both are disposable. |
| `AGENTMETER_MAX_BATCH_SIZE` | `200` | Measurements per request. |
| `AGENTMETER_MAX_QUEUED_BATCHES` | `512` | Ceiling on undelivered batches; the oldest are discarded first, and the discard is reported. |
| `AGENTMETER_RUN_BUDGET_MS` | `5000` | Total wall clock for one run. |
| `AGENTMETER_REQUEST_TIMEOUT_MS` | `2000` | Per-request timeout. |

A tuning variable that is not a positive integer falls back to its default and is reported as an
`invalid-setting` failure naming the variable — never its value. A typo must not be the reason
metrics stop being collected, and must not be silent either.

## Attribution

By default a measurement says how many tokens were spent, when, in which session and on which
model. A repository can also say **what the spend is charged to**, by committing a file,
`.agentmeter.json`, at its root:

```json
{
  "version": 1,
  "attribution": [
    {
      "from": "branch",
      "match": "^(?<task>[A-Z][0-9]{3})-",
      "emit": [{ "type": "task", "key": "{task}" }]
    },
    {
      "from": "source",
      "match": "^(?<name>[a-z0-9-]+)$",
      "emit": [{ "type": "checkout", "key": "{name}" }]
    }
  ]
}
```

With that file and `AGENTMETER_SOURCE=laptop-a`, a turn that ran on the branch `K123-add-export`
is sent with

```json
"dimensions": [
  { "type": "task", "key": "K123" },
  { "type": "checkout", "key": "laptop-a" }
]
```

beside the fields it always had. `add-export` is not sent: no rule captured it. A turn that no
rule matches is sent exactly as before, with no `dimensions` at all.

**A rule** has three keys:

- `from` — what it reads. `"branch"` is the branch name recorded on the turn when it was written.
  `"source"` is the value of `AGENTMETER_SOURCE`. There is no other source: not the working
  directory, not a path, not the session's name.
- `match` — a regular expression over that text, with named groups.
- `emit` — one to eight dimensions. `type` is a word of your own choosing, sent as written;
  the service does not interpret it. `key` is a template: literal text, and `{name}` for what the
  named group `name` captured.

**What leaves your machine** is therefore the `type` you wrote, and a `key` made of the text you
wrote and the text your own pattern's named groups captured, up to 128 characters. Nothing of a
branch name is sent unless a group captures it. A pattern that captures everything sends
everything; that is your repository's declaration, in a file its contributors review.

**How rules are applied.** They are tried in the order written, separately for each source: the
first `branch` rule that matches emits, and the first `source` rule that matches emits. Put a
specific rule before a general one. An `emit` entry is dropped when a group it names took no part
in the match, or when its key comes out empty or longer than 128 characters.

**Naming where metrics come from.** `AGENTMETER_SOURCE` lets one ingest token be used from several
checkouts and tell them apart. It is sent only through a `source` rule, under the `type` that rule
names — so each repository to be compared commits a rule file with one. Set in a repository with
no rule file, it does nothing. The rule's pattern is also where a repository says which names it
accepts: `^(?<name>laptop-a|laptop-b|ci)$` sends nothing for a misspelt one. A name describes the
run that reports: every turn that run collects carries it.

**The file is read strictly.** Its only keys are `version` (which must be `1`) and `attribution`;
a rule's are `from`, `match` and `emit`; a dimension's are `type` and `key`. An unknown key
anywhere, an unknown source, a pattern that does not compile, a `{placeholder}` that names no
group of its pattern, or a limit exceeded makes the whole file invalid — and an invalid file means
**no dimensions are sent at all**, never some of them. The endpoint and the token are not keys of
this file. Limits: 64 KiB, 32 rules, 512 characters per pattern, 64 per `type`, 128 per `key`
template, 16 dimensions per measurement; a branch name longer than 255 characters is not matched.

**It still cannot fail your session, and it never holds back your token counts.** With a file that
is invalid or cannot be read, the run submits its measurements without dimensions and reports an
`attribution` failure naming the check that failed — never the file's content. A pattern that takes
longer than 50 ms to answer is interrupted, and the rules are switched off for the rest of that
run, which is reported as `attribution:rule-timeout`.

**Three things to know before relying on it:**

- **A label is fixed when a measurement is first delivered.** The service keeps the first
  delivery of a measurement. Turns delivered before the file existed, or while it was invalid, stay
  unlabelled; deleting the scan cursor does not relabel them.
- **The file is read from the repository's main working tree**, also for a session opened in a
  linked worktree. Rules on a branch take effect when they reach that checkout.
- **A run with `AGENTMETER_SCOPE=machine` reads no rule file** and sends no dimension.

See [`specs/attribution-rules/decision.md`](specs/attribution-rules/decision.md) for what was
decided and why, including why a session's name is never sent.

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
and the ingestion contract types. The run outcome reports attribution as a count,
`scan.turnsAttributed`, and as failures of the stage `attribution`. The scanning, queueing and transport internals are not part of
this package's contract and may change without notice.

## Security

How to report a vulnerability privately is in [`SECURITY.md`](SECURITY.md).

## Licence

Apache License, Version 2.0 — see [`LICENSE`](LICENSE). Copyright 2026 Alexander Rondon
([`NOTICE`](NOTICE)).
