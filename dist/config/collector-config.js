import { homedir } from "node:os";
import { join } from "node:path";
export const DEFAULT_SCOPE = "repository";
export const DEFAULT_PRICING_TIER = "standard";
export const DEFAULT_MAX_BATCH_SIZE = 200;
export const DEFAULT_MAX_QUEUED_BATCHES = 512;
export const DEFAULT_RUN_BUDGET_MS = 5_000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 2_000;
/** Where Claude Code writes its session transcripts, relative to a home directory. */
export const CLAUDE_TRANSCRIPTS_SUBPATH = [".claude", "projects"];
function trimmed(value) {
    const result = value?.trim();
    return result === undefined || result === "" ? undefined : result;
}
/**
 * A tuning variable that is not a positive integer falls back to its default and records a
 * failure, rather than failing the run. A typo in `AGENTMETER_MAX_BATCH_SIZE` must not be the
 * reason a developer's metrics stop being collected — but it must not be invisible either, which
 * is what the failure record is for.
 */
function positiveInteger(raw, fallback, name, failures) {
    const value = trimmed(raw);
    if (value === undefined) {
        return fallback;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        // `detail` is the variable's NAME, never its value — the value is what would leak.
        failures.push({ stage: "config", reason: "invalid-setting", count: 1, detail: name });
        return fallback;
    }
    return parsed;
}
/**
 * The scope, with the same rule as a tuning variable: a value that is neither of the two falls
 * back to the default and is reported. The default is the narrower one on purpose — a typo must
 * not be what turns one repository's reporting into the whole machine's.
 */
function collectionScope(raw, failures) {
    const value = trimmed(raw);
    if (value === undefined) {
        return DEFAULT_SCOPE;
    }
    if (value === "repository" || value === "machine") {
        return value;
    }
    failures.push({
        stage: "config",
        reason: "invalid-setting",
        count: 1,
        detail: "AGENTMETER_SCOPE",
    });
    return DEFAULT_SCOPE;
}
/**
 * Reads the collector's configuration out of the environment. Never throws.
 *
 * `home` is a parameter rather than a call to `os.homedir()` inside the defaults so the whole
 * function is testable without depending on the machine it runs on.
 */
export function resolveConfigFromEnv(env, home = homedir()) {
    const failures = [];
    const endpoint = trimmed(env.AGENTMETER_ENDPOINT);
    const token = trimmed(env.AGENTMETER_TOKEN);
    if (endpoint === undefined || token === undefined) {
        return { status: "not-configured", failures };
    }
    const cacheRoot = trimmed(env.XDG_CACHE_HOME) ?? join(home, ".cache");
    const config = {
        endpoint,
        token,
        pricingTier: trimmed(env.AGENTMETER_PRICING_TIER) ?? DEFAULT_PRICING_TIER,
        transcriptsDir: trimmed(env.AGENTMETER_TRANSCRIPTS_DIR) ?? join(home, ...CLAUDE_TRANSCRIPTS_SUBPATH),
        scope: collectionScope(env.AGENTMETER_SCOPE, failures),
        cacheDir: trimmed(env.AGENTMETER_CACHE_DIR) ?? join(cacheRoot, "agentmeter"),
        maxBatchSize: positiveInteger(env.AGENTMETER_MAX_BATCH_SIZE, DEFAULT_MAX_BATCH_SIZE, "AGENTMETER_MAX_BATCH_SIZE", failures),
        maxQueuedBatches: positiveInteger(env.AGENTMETER_MAX_QUEUED_BATCHES, DEFAULT_MAX_QUEUED_BATCHES, "AGENTMETER_MAX_QUEUED_BATCHES", failures),
        runBudgetMs: positiveInteger(env.AGENTMETER_RUN_BUDGET_MS, DEFAULT_RUN_BUDGET_MS, "AGENTMETER_RUN_BUDGET_MS", failures),
        requestTimeoutMs: positiveInteger(env.AGENTMETER_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS, "AGENTMETER_REQUEST_TIMEOUT_MS", failures),
    };
    return { status: "configured", config, failures };
}
