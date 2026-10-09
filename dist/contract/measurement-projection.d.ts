import type { UsageTurn } from "../claude-code/usage-extraction.js";
import type { MeasurementEntry } from "./ingest-contract.js";
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
export declare const MEASUREMENT_ENTRY_FIELDS: readonly ["idempotencyKey", "occurredAt", "sessionId", "model", "pricingTier", "tokens", "dimensions"];
/** The complete field set of one dimension. */
export declare const DIMENSION_FIELDS: readonly ["type", "key"];
export declare const TOKEN_FIELDS: readonly ["input", "output", "cacheWrite5m", "cacheWrite1h", "cacheRead"];
export declare function projectMeasurement(turn: UsageTurn, pricingTier: string): MeasurementEntry;
/** Total across the five buckets — the tiebreak that collapses duplicate keys (research.md
 * Decision 2). */
export declare function measurementTotal(entry: MeasurementEntry): number;
