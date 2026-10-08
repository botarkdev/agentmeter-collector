import { totalTokens } from "../claude-code/usage-extraction.js";
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
];
export const TOKEN_FIELDS = [
    "input",
    "output",
    "cacheWrite5m",
    "cacheWrite1h",
    "cacheRead",
];
export function projectMeasurement(turn, pricingTier) {
    const tokens = {
        input: turn.tokens.input,
        output: turn.tokens.output,
        cacheWrite5m: turn.tokens.cacheWrite5m,
        cacheWrite1h: turn.tokens.cacheWrite1h,
        cacheRead: turn.tokens.cacheRead,
    };
    // Two explicit literals rather than one plus a conditional spread: the schema refuses a null or
    // empty `sessionId`, and "absent" has to mean the key is not there at all.
    if (turn.sessionId === undefined) {
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
        sessionId: turn.sessionId,
        model: turn.model,
        pricingTier,
        tokens,
    };
}
/** Total across the five buckets — the tiebreak that collapses duplicate keys (research.md
 * Decision 2). */
export function measurementTotal(entry) {
    return totalTokens(entry.tokens);
}
