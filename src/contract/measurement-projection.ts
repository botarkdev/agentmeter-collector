import type { UsageTurn } from "../claude-code/usage-extraction.js";
import { totalTokens } from "../claude-code/usage-extraction.js";
import type { MeasurementEntry, WireDimension } from "./ingest-contract.js";

/**
 * The allowlist projection (spec.md FR-024; research.md Decision 5).
 *
 * Every field of the outbound entry is written out by name, from a named argument. Nothing is
 * spread, copied, merged, or passed through and then stripped — so a field added to a future
 * Claude Code transcript format cannot arrive on the wire by default. A denylist would have to be
 * updated every time the transcript gains a field, and would be wrong silently until somebody
 * noticed; this is wrong loudly, because a field nobody wrote here simply is not there.
 *
 * This matters concretely: the transcript events these turns come from carry `cwd`, `gitBranch`,
 * `slug`, `entrypoint`, `error` and the full text of every prompt, tool call and file the agent
 * read. The service is about to be public.
 *
 * `dimensions` is the one field whose values a repository's own rules derive
 * (specs/attribution-rules/decision.md). It is written out the same way: each dimension is rebuilt
 * from its two named properties, so whatever else an object handed in here might carry stays
 * behind.
 */

/** The complete field set of a submitted measurement. Exported so the content-safety test can
 * assert the wire object's key set EQUALS this, rather than merely not containing markers. */
export const MEASUREMENT_ENTRY_FIELDS = [
  "idempotencyKey",
  "occurredAt",
  "sessionId",
  "model",
  "pricingTier",
  "tokens",
  "dimensions",
] as const;

/** The complete field set of one dimension. */
export const DIMENSION_FIELDS = ["type", "key"] as const;

export const TOKEN_FIELDS = [
  "input",
  "output",
  "cacheWrite5m",
  "cacheWrite1h",
  "cacheRead",
] as const;

export function projectMeasurement(turn: UsageTurn, pricingTier: string): MeasurementEntry {
  const tokens = {
    input: turn.tokens.input,
    output: turn.tokens.output,
    cacheWrite5m: turn.tokens.cacheWrite5m,
    cacheWrite1h: turn.tokens.cacheWrite1h,
    cacheRead: turn.tokens.cacheRead,
  };

  const dimensions: WireDimension[] = [];
  for (const dimension of turn.dimensions ?? []) {
    dimensions.push({ type: dimension.type, key: dimension.key });
  }

  // Explicit literals rather than one plus conditional spreads: the schema refuses a null or
  // empty `sessionId`, and "absent" has to mean the key is not there at all. The same holds for
  // `dimensions`: a measurement with none is the entry this collector always sent.
  if (turn.sessionId === undefined) {
    if (dimensions.length === 0) {
      return {
        idempotencyKey: turn.messageId,
        occurredAt: turn.occurredAt,
        model: turn.model,
        pricingTier,
        tokens,
      };
    }
    return {
      idempotencyKey: turn.messageId,
      occurredAt: turn.occurredAt,
      model: turn.model,
      pricingTier,
      tokens,
      dimensions,
    };
  }
  if (dimensions.length === 0) {
    return {
      idempotencyKey: turn.messageId,
      occurredAt: turn.occurredAt,
      sessionId: turn.sessionId,
      model: turn.model,
      pricingTier,
      tokens,
    };
  }
  return {
    idempotencyKey: turn.messageId,
    occurredAt: turn.occurredAt,
    sessionId: turn.sessionId,
    model: turn.model,
    pricingTier,
    tokens,
    dimensions,
  };
}

/** Total across the five buckets — the tiebreak that collapses duplicate keys (research.md
 * Decision 2). */
export function measurementTotal(entry: MeasurementEntry): number {
  return totalTokens(entry.tokens);
}
