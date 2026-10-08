const IGNORED = { kind: "ignored" };
const OUT_OF_SCOPE = { kind: "out-of-scope" };
function skipped(reason) {
    return { kind: "skipped", reason };
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmptyString(value) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
/**
 * One token counter. Absent (or null) means zero, exactly as the reference implementation's `?? 0`
 * treats it. Anything present that is not a non-negative integer makes the whole turn malformed —
 * a fractional or negative count is a shape this collector does not understand, and guessing at
 * it would submit a number nobody measured.
 */
function counter(value) {
    if (value === undefined || value === null) {
        return 0;
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        return undefined;
    }
    return value;
}
/**
 * The five buckets, derived exactly as `scripts/usage-report.mjs` derives them (spec.md FR-005;
 * research.md Decision 4):
 *
 * - `cacheWrite1h` is the itemised 1-hour ephemeral count.
 * - `cacheWrite5m` is the itemised 5-minute count when present, and otherwise the flat
 *   `cache_creation_input_tokens` minus the 1-hour count, floored at zero. The fallback is what
 *   keeps older transcripts — the ones predating the itemised `cache_creation` object — readable.
 *
 * `usage.service_tier` is deliberately NOT read: it is the API's standard/batch/priority service
 * class, not the introductory-versus-standard PRICING tier the service's contract means, and
 * conflating the two would misprice every measurement (research.md Decision 4).
 */
function readTokenCounts(usage) {
    const creation = isRecord(usage.cache_creation) ? usage.cache_creation : undefined;
    const input = counter(usage.input_tokens);
    const output = counter(usage.output_tokens);
    const cacheRead = counter(usage.cache_read_input_tokens);
    const cacheWrite1h = counter(creation?.ephemeral_1h_input_tokens);
    if (input === undefined ||
        output === undefined ||
        cacheRead === undefined ||
        cacheWrite1h === undefined) {
        return undefined;
    }
    const itemised5m = creation?.ephemeral_5m_input_tokens;
    let cacheWrite5m;
    if (itemised5m !== undefined && itemised5m !== null) {
        cacheWrite5m = counter(itemised5m);
    }
    else {
        const flat = counter(usage.cache_creation_input_tokens);
        cacheWrite5m = flat === undefined ? undefined : Math.max(0, flat - cacheWrite1h);
    }
    if (cacheWrite5m === undefined) {
        return undefined;
    }
    return { input, output, cacheWrite5m, cacheWrite1h, cacheRead };
}
export function totalTokens(tokens) {
    return (tokens.input + tokens.output + tokens.cacheWrite5m + tokens.cacheWrite1h + tokens.cacheRead);
}
/**
 * A parsed transcript line in; a `UsageTurn`, a counted skip, or nothing, out.
 *
 * The key is `message.id` alone (research.md Decision 1). Measured over 60 real transcripts:
 * 5 616 of 8 667 message ids appear on more than one line, 404 appear under more than one session
 * id after a resume, 14 turns carry no `requestId` at all, and no id was ever seen under two
 * different request ids. So the id alone deduplicates everything the composite would, keys the
 * turns the composite cannot, and — unlike anything containing the session id — survives a
 * resumed session without charging its earlier turns twice.
 *
 * `accepts`, when given, is asked before anything else is checked: a turn of another repository
 * is none of this run's business, and reporting its missing model as a skip would fill one
 * repository's outcome with another's anomalies.
 */
export function extractUsageTurn(value, accepts) {
    if (!isRecord(value) || value.type !== "assistant") {
        return IGNORED;
    }
    const message = value.message;
    if (!isRecord(message) || !isRecord(message.usage)) {
        return IGNORED;
    }
    if (accepts !== undefined && !accepts(nonEmptyString(value.cwd))) {
        return OUT_OF_SCOPE;
    }
    const messageId = nonEmptyString(message.id);
    if (messageId === undefined) {
        return skipped("missing-key");
    }
    const occurredAt = nonEmptyString(value.timestamp);
    if (occurredAt === undefined) {
        return skipped("missing-timestamp");
    }
    const model = nonEmptyString(message.model);
    if (model === undefined) {
        return skipped("missing-model");
    }
    const tokens = readTokenCounts(message.usage);
    if (tokens === undefined) {
        return skipped("invalid-token-counts");
    }
    // A turn contributing to none of the five buckets measures nothing. This is also what removes
    // Claude Code's `<synthetic>` placeholder turns without this package having to know that name —
    // all 21 observed carried zero in every bucket (research.md Decision 3).
    if (totalTokens(tokens) === 0) {
        return skipped("zero-token-turn");
    }
    const sessionId = nonEmptyString(value.sessionId) ?? nonEmptyString(value.session_id);
    if (sessionId === undefined) {
        return { kind: "turn", turn: { messageId, occurredAt, model, tokens } };
    }
    return { kind: "turn", turn: { messageId, occurredAt, sessionId, model, tokens } };
}
