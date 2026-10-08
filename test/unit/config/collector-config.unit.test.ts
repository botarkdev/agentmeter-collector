import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_BATCH_SIZE,
  DEFAULT_PRICING_TIER,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_RUN_BUDGET_MS,
  resolveConfigFromEnv,
} from "../../../src/config/collector-config.js";

const HOME = "/home/placeholder";
const CONFIGURED = {
  AGENTMETER_ENDPOINT: "https://collector.invalid",
  AGENTMETER_TOKEN: "amk_live_placeholder",
} as const;

describe("resolveConfigFromEnv", () => {
  it("is not configured when the endpoint is missing", () => {
    const resolved = resolveConfigFromEnv({ AGENTMETER_TOKEN: "amk_live_x" }, HOME);
    expect(resolved.status).toBe("not-configured");
  });

  it("is not configured when the token is missing", () => {
    const resolved = resolveConfigFromEnv({ AGENTMETER_ENDPOINT: "https://x.invalid" }, HOME);
    expect(resolved.status).toBe("not-configured");
  });

  it("treats a whitespace-only value as absent", () => {
    const resolved = resolveConfigFromEnv(
      { AGENTMETER_ENDPOINT: "   ", AGENTMETER_TOKEN: "amk_live_x" },
      HOME,
    );
    expect(resolved.status).toBe("not-configured");
  });

  it("being unconfigured is not a failure — a hook fires in repositories that never opted in", () => {
    const resolved = resolveConfigFromEnv({}, HOME);
    expect(resolved.status).toBe("not-configured");
    expect(resolved.failures).toEqual([]);
  });

  it("fills every default when only the endpoint and token are set", () => {
    const resolved = resolveConfigFromEnv(CONFIGURED, HOME);
    expect(resolved.status).toBe("configured");
    if (resolved.status !== "configured") return;
    expect(resolved.config).toMatchObject({
      pricingTier: DEFAULT_PRICING_TIER,
      maxBatchSize: DEFAULT_MAX_BATCH_SIZE,
      runBudgetMs: DEFAULT_RUN_BUDGET_MS,
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    });
    expect(resolved.config.transcriptsDir).toBe(`${HOME}/.claude/projects`);
    expect(resolved.config.cacheDir).toBe(`${HOME}/.cache/agentmeter`);
    expect(resolved.failures).toEqual([]);
  });

  it("honours XDG_CACHE_HOME for the cache directory", () => {
    const resolved = resolveConfigFromEnv(
      { ...CONFIGURED, XDG_CACHE_HOME: "/elsewhere/cache" },
      HOME,
    );
    expect(resolved.status === "configured" && resolved.config.cacheDir).toBe(
      "/elsewhere/cache/agentmeter",
    );
  });

  it("lets an explicit cache directory win over XDG", () => {
    const resolved = resolveConfigFromEnv(
      { ...CONFIGURED, XDG_CACHE_HOME: "/elsewhere", AGENTMETER_CACHE_DIR: "/explicit" },
      HOME,
    );
    expect(resolved.status === "configured" && resolved.config.cacheDir).toBe("/explicit");
  });

  it.each([
    ["not a number", "many"],
    ["zero", "0"],
    ["negative", "-5"],
    ["fractional", "2.5"],
  ])("falls back to the default when a tuning value is %s, and says so", (_label, value) => {
    const resolved = resolveConfigFromEnv(
      { ...CONFIGURED, AGENTMETER_MAX_BATCH_SIZE: value },
      HOME,
    );
    expect(resolved.status).toBe("configured");
    if (resolved.status !== "configured") return;
    expect(resolved.config.maxBatchSize).toBe(DEFAULT_MAX_BATCH_SIZE);
    expect(resolved.failures).toEqual([
      { stage: "config", reason: "invalid-setting", count: 1, detail: "AGENTMETER_MAX_BATCH_SIZE" },
    ]);
  });

  it("names the variable in a failure, never its value", () => {
    const resolved = resolveConfigFromEnv(
      { ...CONFIGURED, AGENTMETER_RUN_BUDGET_MS: "secret-looking-nonsense" },
      HOME,
    );
    expect(JSON.stringify(resolved.failures)).not.toContain("secret-looking-nonsense");
  });

  it("reads every tuning variable when they are all valid", () => {
    const resolved = resolveConfigFromEnv(
      {
        ...CONFIGURED,
        AGENTMETER_PRICING_TIER: "intro",
        AGENTMETER_TRANSCRIPTS_DIR: "/transcripts",
        AGENTMETER_MAX_BATCH_SIZE: "10",
        AGENTMETER_MAX_QUEUED_BATCHES: "20",
        AGENTMETER_RUN_BUDGET_MS: "1000",
        AGENTMETER_REQUEST_TIMEOUT_MS: "300",
      },
      HOME,
    );
    expect(resolved.status === "configured" && resolved.config).toMatchObject({
      pricingTier: "intro",
      transcriptsDir: "/transcripts",
      maxBatchSize: 10,
      maxQueuedBatches: 20,
      runBudgetMs: 1000,
      requestTimeoutMs: 300,
    });
  });

  it("reports only the repository it runs in unless told otherwise", () => {
    const resolved = resolveConfigFromEnv(CONFIGURED, HOME);
    expect(resolved.status === "configured" && resolved.config.scope).toBe("repository");
  });

  it("reports the whole machine when asked to", () => {
    const resolved = resolveConfigFromEnv({ ...CONFIGURED, AGENTMETER_SCOPE: " machine " }, HOME);
    expect(resolved.status === "configured" && resolved.config.scope).toBe("machine");
    expect(resolved.failures).toEqual([]);
  });

  it("falls back to the repository for a scope it does not know, and names the setting", () => {
    const resolved = resolveConfigFromEnv({ ...CONFIGURED, AGENTMETER_SCOPE: "everything" }, HOME);

    expect(resolved.status === "configured" && resolved.config.scope).toBe("repository");
    expect(resolved.failures).toEqual([
      { stage: "config", reason: "invalid-setting", count: 1, detail: "AGENTMETER_SCOPE" },
    ]);
  });
});
