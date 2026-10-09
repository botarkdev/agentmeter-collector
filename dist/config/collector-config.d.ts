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
    /** `repository`: only the repository the run was started in. `machine`: every transcript under
     * `transcriptsDir` (specs/repository-scope/decision.md). */
    readonly scope: CollectionScope;
    /** A name the user declared for where these metrics come from (`AGENTMETER_SOURCE`). Absent
     * when none is declared. It reaches the wire only through a `source` rule of the repository's
     * committed attribution file, never by itself (specs/attribution-rules/decision.md). */
    readonly sourceName?: string;
    readonly cacheDir: string;
    readonly maxBatchSize: number;
    readonly maxQueuedBatches: number;
    readonly runBudgetMs: number;
    readonly requestTimeoutMs: number;
}
export type ResolvedConfig = {
    readonly status: "configured";
    readonly config: CollectorConfig;
    readonly failures: readonly FailureRecord[];
} | {
    readonly status: "not-configured";
    readonly failures: readonly FailureRecord[];
};
export type CollectionScope = "repository" | "machine";
export declare const DEFAULT_SCOPE: CollectionScope;
export declare const DEFAULT_PRICING_TIER = "standard";
export declare const DEFAULT_MAX_BATCH_SIZE = 200;
export declare const DEFAULT_MAX_QUEUED_BATCHES = 512;
export declare const DEFAULT_RUN_BUDGET_MS = 5000;
export declare const DEFAULT_REQUEST_TIMEOUT_MS = 2000;
/** The longest declared source name that is taken. */
export declare const MAX_SOURCE_NAME_LENGTH = 255;
/** Where Claude Code writes its session transcripts, relative to a home directory. */
export declare const CLAUDE_TRANSCRIPTS_SUBPATH: readonly [".claude", "projects"];
interface EnvLike {
    readonly [key: string]: string | undefined;
}
/**
 * Reads the collector's configuration out of the environment. Never throws.
 *
 * `home` is a parameter rather than a call to `os.homedir()` inside the defaults so the whole
 * function is testable without depending on the machine it runs on.
 */
export declare function resolveConfigFromEnv(env: EnvLike, home?: string): ResolvedConfig;
export {};
