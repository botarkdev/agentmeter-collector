import { homedir } from "node:os";
import { join } from "node:path";
import type { FailureRecord } from "../run/run-outcome.js";

/**
 * Everything the collector needs to run, and the one place environment values enter this package
 * (specs/0019-claude-code-collector/data-model.md).
 *
 * No value here has a committed default that names a host, a port or a credential — Constitution,
 * "Environment-specific values are never committed". The two that identify a deployment
 * (`endpoint`, `token`) have NO default at all: without them the collector does nothing and says
 * so, because a `SessionEnd` hook fires in repositories that never opted in.
 */
export interface CollectorConfig {
  readonly endpoint: string;
  readonly token: string;
  readonly pricingTier: string;
  readonly transcriptsDir: string;
  readonly cacheDir: string;
  readonly maxBatchSize: number;
  readonly maxQueuedBatches: number;
  readonly runBudgetMs: number;
  readonly requestTimeoutMs: number;
}

export type ResolvedConfig =
  | {
      readonly status: "configured";
      readonly config: CollectorConfig;
      readonly failures: readonly FailureRecord[];
    }
  | { readonly status: "not-configured"; readonly failures: readonly FailureRecord[] };

export const DEFAULT_PRICING_TIER = "standard";
export const DEFAULT_MAX_BATCH_SIZE = 200;
export const DEFAULT_MAX_QUEUED_BATCHES = 512;
export const DEFAULT_RUN_BUDGET_MS = 5_000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 2_000;

/** Where Claude Code writes its session transcripts, relative to a home directory. */
export const CLAUDE_TRANSCRIPTS_SUBPATH = [".claude", "projects"] as const;

interface EnvLike {
  readonly [key: string]: string | undefined;
}

function trimmed(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result === undefined || result === "" ? undefined : result;
}

/**
 * A tuning variable that is not a positive integer falls back to its default and records a
 * failure, rather than failing the run. A typo in `AGENTMETER_MAX_BATCH_SIZE` must not be the
 * reason a developer's metrics stop being collected — but it must not be invisible either, which
 * is what the failure record is for.
 */
function positiveInteger(
  raw: string | undefined,
  fallback: number,
  name: string,
  failures: FailureRecord[],
): number {
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
 * Reads the collector's configuration out of the environment. Never throws.
 *
 * `home` is a parameter rather than a call to `os.homedir()` inside the defaults so the whole
 * function is testable without depending on the machine it runs on.
 */
export function resolveConfigFromEnv(env: EnvLike, home: string = homedir()): ResolvedConfig {
  const failures: FailureRecord[] = [];

  const endpoint = trimmed(env.AGENTMETER_ENDPOINT);
  const token = trimmed(env.AGENTMETER_TOKEN);
  if (endpoint === undefined || token === undefined) {
    return { status: "not-configured", failures };
  }

  const cacheRoot = trimmed(env.XDG_CACHE_HOME) ?? join(home, ".cache");

  const config: CollectorConfig = {
    endpoint,
    token,
    pricingTier: trimmed(env.AGENTMETER_PRICING_TIER) ?? DEFAULT_PRICING_TIER,
    transcriptsDir:
      trimmed(env.AGENTMETER_TRANSCRIPTS_DIR) ?? join(home, ...CLAUDE_TRANSCRIPTS_SUBPATH),
    cacheDir: trimmed(env.AGENTMETER_CACHE_DIR) ?? join(cacheRoot, "agentmeter"),
    maxBatchSize: positiveInteger(
      env.AGENTMETER_MAX_BATCH_SIZE,
      DEFAULT_MAX_BATCH_SIZE,
      "AGENTMETER_MAX_BATCH_SIZE",
      failures,
    ),
    maxQueuedBatches: positiveInteger(
      env.AGENTMETER_MAX_QUEUED_BATCHES,
      DEFAULT_MAX_QUEUED_BATCHES,
      "AGENTMETER_MAX_QUEUED_BATCHES",
      failures,
    ),
    runBudgetMs: positiveInteger(
      env.AGENTMETER_RUN_BUDGET_MS,
      DEFAULT_RUN_BUDGET_MS,
      "AGENTMETER_RUN_BUDGET_MS",
      failures,
    ),
    requestTimeoutMs: positiveInteger(
      env.AGENTMETER_REQUEST_TIMEOUT_MS,
      DEFAULT_REQUEST_TIMEOUT_MS,
      "AGENTMETER_REQUEST_TIMEOUT_MS",
      failures,
    ),
  };

  return { status: "configured", config, failures };
}
