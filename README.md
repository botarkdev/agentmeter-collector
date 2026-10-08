# @agentmeter/collector

Reads a coding agent's local usage logs and reports them to agentmeter — without ever blocking or
failing the agent session that produced them.

Today it carries one adapter, for Claude Code: it scans the JSONL session transcripts Claude Code
already writes, normalises each assistant turn to agentmeter's ingestion contract, keeps on disk
whatever it could not deliver, and sends. See
[`specs/0019-claude-code-collector/`](specs/0019-claude-code-collector/) for what it does and
why it does it that way.

## The two things worth knowing before you use it

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

It submits no attribution dimensions at all. Deriving one would mean reading a branch name or a
path, which is exactly what the paragraph above rules out; declaring attribution rules is a
separate, later piece of work.

## Use it as a library

```ts
import { resolveConfigFromEnv, runCollector } from "@agentmeter/collector";

const outcome = await runCollector(resolveConfigFromEnv(process.env));
// outcome.status is "collected" or "not-configured"; outcome.failures says what went wrong.
```

## Use it from a hook

```bash
pnpm install
pnpm build
```

```jsonc
// .claude/settings.json
{
  "hooks": {
    "SessionEnd": [
      { "hooks": [{ "type": "command", "command": "agentmeter push" }] }
    ]
  }
}
```

## Configuration

Every value comes from the environment. None of them may be committed to any file (Constitution,
"Environment-specific values are never committed"). Only the first two are required; without them
the collector does nothing, says so, and exits 0 — a hook fires in repositories that never opted
in.

| Variable | Default | Meaning |
| --- | --- | --- |
| `AGENTMETER_ENDPOINT` | — | Base URL of the agentmeter service. The collector appends `/api/v1/ingest`. |
| `AGENTMETER_TOKEN` | — | Ingest token, sent as `Authorization: Bearer`. Never written to disk, to stdout, or into a queued batch. |
| `AGENTMETER_PRICING_TIER` | `standard` | The pricing tier asserted on each measurement. The collector holds no price table and cannot compute this; the service treats it as the client's assertion. |
| `AGENTMETER_TRANSCRIPTS_DIR` | `~/.claude/projects` | Where Claude Code writes session transcripts. |
| `AGENTMETER_CACHE_DIR` | `$XDG_CACHE_HOME/agentmeter`, else `~/.cache/agentmeter` | Holds the queue of undelivered batches and the scan cursor. Both are disposable. |
| `AGENTMETER_MAX_BATCH_SIZE` | `200` | Measurements per request. |
| `AGENTMETER_MAX_QUEUED_BATCHES` | `512` | Ceiling on undelivered batches; the oldest are discarded first, and the discard is reported. |
| `AGENTMETER_RUN_BUDGET_MS` | `5000` | Total wall clock for one run. |
| `AGENTMETER_REQUEST_TIMEOUT_MS` | `2000` | Per-request timeout. |

A tuning variable that is not a positive integer falls back to its default and is reported as an
`invalid-setting` failure naming the variable — never its value. A typo must not be the reason
metrics stop being collected, and must not be silent either.

## What it puts on your disk

Both live under `AGENTMETER_CACHE_DIR` and both are safe to delete at any time:

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
| `pnpm build` | Compiles to `dist/`, which is what the `agentmeter` binary runs from. |
| `pnpm test:unit` | Runs `*.unit.test.ts`. No network, and nothing outside a temporary directory. |
| `pnpm test:cov` | Runs the unit suite with coverage; fails below the declared 80% threshold. |
| `pnpm typecheck` | Type-checks sources and tests. |
| `pnpm format:check` | Fails on a file Prettier would rewrite; `pnpm format` rewrites it. |

## Public surface

`runCollector`, `resolveConfigFromEnv`, `runCli`, `summarise`, the `RunOutcome` family of types,
and the ingestion contract types. The scanning, queueing and transport internals are not part of
this package's contract and may change without notice.
