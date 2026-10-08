# Quickstart: Claude Code collector

**Feature**: `0019-claude-code-collector`

## As a library

```ts
import { resolveConfigFromEnv, runCollector } from "@agentmeter/collector";

const resolved = resolveConfigFromEnv(process.env);
const outcome = await runCollector(resolved);
// Never rejects. `outcome.status` is "collected" or "not-configured".
```

`runCollector` is the whole feature. It scans, projects, enqueues, drains and returns; it does
not throw for any input, any filesystem state, or any behaviour of the service.

## As a hook

Build once, then wire it:

```bash
pnpm --filter @agentmeter/collector build
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

`agentmeter push` exits 0 whatever happens — including when the service is down, the token has
expired, or nothing is configured at all. That is the point of it.

## Configuration

Every value comes from the environment; none of them may be committed anywhere (Constitution,
Environment Configuration). Only the first two are required, and without them the collector does
nothing and says so.

| Variable | Default | Meaning |
| --- | --- | --- |
| `AGENTMETER_ENDPOINT` | — | Base URL of the agentmeter service. The collector appends `/api/v1/ingest`. |
| `AGENTMETER_TOKEN` | — | Ingest token, sent as `Authorization: Bearer`. Never written anywhere else. |
| `AGENTMETER_PRICING_TIER` | `standard` | The tier asserted on each measurement. |
| `AGENTMETER_TRANSCRIPTS_DIR` | `~/.claude/projects` | Where Claude Code writes session transcripts. |
| `AGENTMETER_CACHE_DIR` | `${XDG_CACHE_HOME:-~/.cache}/agentmeter` | Queue and cursor. |
| `AGENTMETER_MAX_BATCH_SIZE` | `200` | Measurements per request. |
| `AGENTMETER_MAX_QUEUED_BATCHES` | `512` | Ceiling on undelivered batches; oldest discarded first. |
| `AGENTMETER_RUN_BUDGET_MS` | `5000` | Total wall clock for one run. |
| `AGENTMETER_REQUEST_TIMEOUT_MS` | `2000` | Per-request timeout. |

## Verifying it locally

```bash
pnpm --filter @agentmeter/collector test:unit   # the whole suite, no network, no ~/.claude
pnpm --filter @agentmeter/collector test:cov    # with the 80% threshold enforced
pnpm --filter @agentmeter/collector typecheck
```

To watch it work against a running service, point `AGENTMETER_ENDPOINT` at it, export a token
issued from the dashboard, and run `agentmeter push` twice. The first run reports measurements
under `accepted`; the second reports the same number under `deduplicated` and changes no total.
That is idempotency, observable in one command.

To see the never-fails property, point `AGENTMETER_ENDPOINT` at something that is not listening
and run it again: the batch moves to the queue, the exit code is 0, and the next successful run
delivers it.
