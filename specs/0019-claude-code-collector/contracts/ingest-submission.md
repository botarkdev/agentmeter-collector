# Contract: what the collector submits, and what it does with each answer

**Feature**: `0019-claude-code-collector`

This is a *consumer* contract. The authority is the deployed endpoint —
`apps/api/src/routes/ingest.route.ts`, `apps/api/src/dto/ingest-request.schema.ts`,
`specs/0011-ingestion-endpoint/`, `specs/0013-ingest-tokens/`,
`specs/0017-ingestion-rate-limiting/`. Nothing here changes it. This document records what the
collector sends, and, more importantly, what it must do with every answer the endpoint can give,
because that is where "never blocks, never fails, never double-counts" is either kept or lost.

## The request

```http
POST {endpoint}/api/v1/ingest
Authorization: Bearer {ingest token}
Content-Type: application/json
```

```jsonc
{
  "agent": "claude-code",
  "measurements": [
    {
      "idempotencyKey": "msg_011CdR6vuxzaDp8odFK64Zqk",
      "occurredAt": "2026-07-26T17:58:32.651Z",
      "sessionId": "01397acd-3bf1-46e7-a931-53075e6a54d0",
      "model": "claude-opus-5",
      "pricingTier": "standard",
      "tokens": {
        "input": 2,
        "output": 348,
        "cacheWrite5m": 0,
        "cacheWrite1h": 7028,
        "cacheRead": 20628
      }
    }
  ]
}
```

**That is the complete set of fields the collector ever sends.** There is no `payload`, no
`dimensions`, no `weight`, no `confidence`, no project id and no user id — the last two are the
service's to derive from the token, and the rest belong to features that do not exist yet
(research.md Decision 12). The request schema is `.strict()` at both levels, so sending anything
else would fail the whole batch; the allowlist projection means it cannot arise.

Field by field:

| Field | Source | Notes |
| --- | --- | --- |
| `agent` | constant `"claude-code"` | Batch-level, exactly one agent per batch. |
| `idempotencyKey` | the transcript event's `message.id`, verbatim | research.md Decision 1. Stable across runs, files, sessions and machines. |
| `occurredAt` | the event's `timestamp`, verbatim | The client's clock (architecture proposal §7.4). ISO 8601; the endpoint accepts a real offset as well as `Z`. |
| `sessionId` | the event's `sessionId` (or `session_id`) | Optional in the contract. Omitted entirely when absent — never sent as `null` or as an empty string, both of which the schema refuses. |
| `model` | `message.model`, verbatim | Required non-empty. |
| `pricingTier` | configuration, default `"standard"` | research.md Decision 9. The collector holds no price table. |
| `tokens.*` | the five derived buckets | research.md Decision 4. Non-negative integers. |

**Batching.** At most `maxBatchSize` entries per request (default 200). The endpoint's body limit
is 1 MiB and its rate limits count individual entries, so batches are bounded by entry count on
the client side rather than by guessing at bytes. A batch is never empty.

## The answers, and what each one means for retained work

The endpoint answers `200` with `{accepted, deduplicated, rejected, cost}`, or an error with
`{code, message, action}` where `action` is one of `RETRY`, `DO_NOT_RETRY`, `FIX_AND_RETRY`,
`REAUTHENTICATE`. A `429` additionally carries `Retry-After` in seconds.

| Answer | Batch is | Run | Why |
| --- | --- | --- | --- |
| `200` with the documented body | **removed** | continues | The service has accounted for every entry. `deduplicated` is a success, not a problem — it is what a replay is supposed to look like. `rejected` is recorded in the outcome; resending would be rejected identically forever. |
| `200` with a body that does not match the documented shape | **retained** | continues to the next batch | Cannot be positively recognised as delivery. A proxy's HTML error page returning 200 is the case this exists for (FR-020). |
| `4xx` with `action: DO_NOT_RETRY` or `FIX_AND_RETRY` | **removed** | continues | The service has declared this batch permanently unacceptable. Retaining it would fill the queue forever and push out work that could still succeed (FR-021, FR-022). The discard and its `code` are recorded in the outcome. |
| `401`, or any `action: REAUTHENTICATE` | **retained** | **stops draining** | Every remaining batch would fail identically, and spending the budget proving it is exactly the obstruction Principle IV forbids. The token may be replaced before the next run. |
| `429` | **retained** | **stops draining**, records the stated wait | The service named a wait. Ignoring it is what turns a rate limit into a ban. |
| `5xx`, or `action: RETRY` | **retained** | continues to the next batch | Transient. |
| Any other `4xx` — no `action` this collector recognises | **discarded** | continues | A 4xx is by definition a refusal of what was sent; resending identical bytes cannot change it, so retaining would clog the queue on something that can never succeed. The status and any `code` are recorded. |
| Network refused, DNS failure, TLS failure | **retained** | **stops draining** | The service is unreachable; the next batch will fail the same way. This is the normal case, not the exception. |
| Timeout (per-request budget spent) | **retained** | **stops draining** | Same reasoning, and continuing would spend the run budget on hangs. |
| Run budget spent | **retained** | stops | FR-014. |

Two invariants hold across every row, and both are tested:

- **A batch is removed only when the service has accounted for it** — accepted, deduplicated,
  rejected, or declared permanently invalid. Every other outcome retains.
- **No answer, and no absence of an answer, ever propagates out of the run as an exception.**

## What the collector never does

- Never sends the token anywhere but the `Authorization` header — not in a URL, not in a query
  string, not in a retained file, not in its printed outcome (FR-011, FR-027).
- Never sends a field the ingestion contract does not define (FR-012, FR-024).
- Never sends anything derived from message content, tool input or output, file contents, file
  paths, the working directory, the git branch, or a transcript's location on disk (FR-025).
- Never follows a redirect to a host other than the configured endpoint, and treats a redirect as
  "not delivered" rather than as success.
- Never retries an entry the service accepted (FR-019).
