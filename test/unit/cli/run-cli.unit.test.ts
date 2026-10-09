import { describe, expect, it } from "vitest";
import { USAGE, runCli, summarise } from "../../../src/cli/run-cli.js";
import type { RunOutcome } from "../../../src/run/run-outcome.js";

const TOKEN = "amk_live_placeholder_token_that_must_not_leak";

function lines() {
  const written: string[] = [];
  return { written, stdout: (line: string) => written.push(line) };
}

const BASE: RunOutcome = {
  status: "collected",
  scan: {
    filesConsidered: 1,
    filesRead: 1,
    linesRead: 10,
    turnsFound: 4,
    turnsOutOfScope: 0,
    turnsAttributed: 0,
    measurements: 3,
    duplicatesCollapsed: 1,
  },
  delivery: { batchesSent: 1, accepted: 3, deduplicated: 0, rejected: 0 },
  queue: { enqueued: 1, remaining: 0, discarded: 0 },
  skipped: [],
  failures: [],
  durationMs: 40,
  budgetExhausted: false,
};

describe("runCli", () => {
  it("returns 0 when nothing is configured, and says what to set", async () => {
    const io = lines();
    const code = await runCli(["push"], { stdout: io.stdout, env: {} });

    expect(code).toBe(0);
    expect(io.written).toHaveLength(1);
    expect(io.written[0]).toContain("not configured");
  });

  it("defaults to push when given no argument", async () => {
    const io = lines();
    expect(await runCli([], { stdout: io.stdout, env: {} })).toBe(0);
    expect(io.written[0]).toContain("agentmeter:");
  });

  it("returns 0 and prints usage for an unknown command", async () => {
    const io = lines();
    expect(await runCli(["explode"], { stdout: io.stdout, env: {} })).toBe(0);
    expect(io.written).toEqual([USAGE]);
  });

  it("returns 0 even when everything about the run went wrong", async () => {
    // Configured to point at a reserved TLD that can never resolve, with a transcripts directory
    // that does not exist: the run fails at every stage it can, and the exit code is still 0.
    const io = lines();
    const code = await runCli(["push"], {
      stdout: io.stdout,
      env: {
        AGENTMETER_ENDPOINT: "https://collector.invalid",
        AGENTMETER_TOKEN: TOKEN,
        AGENTMETER_TRANSCRIPTS_DIR: "/definitely/not/a/directory",
        AGENTMETER_CACHE_DIR: "/definitely/not/a/directory/cache",
        AGENTMETER_RUN_BUDGET_MS: "50",
        AGENTMETER_REQUEST_TIMEOUT_MS: "10",
      },
    });

    expect(code).toBe(0);
    expect(io.written).toHaveLength(1);
  });

  it("never prints the token, even though one is configured", async () => {
    const io = lines();
    await runCli(["push"], {
      stdout: io.stdout,
      env: {
        AGENTMETER_ENDPOINT: "https://collector.invalid",
        AGENTMETER_TOKEN: TOKEN,
        AGENTMETER_TRANSCRIPTS_DIR: "/definitely/not/a/directory",
        AGENTMETER_CACHE_DIR: "/definitely/not/a/directory/cache",
        AGENTMETER_RUN_BUDGET_MS: "50",
        AGENTMETER_REQUEST_TIMEOUT_MS: "10",
      },
    });

    expect(io.written.join("\n")).not.toContain(TOKEN);
    expect(io.written.join("\n")).not.toContain("amk_live");
  });
});

describe("summarise", () => {
  it("reports the counts a developer would want to see", () => {
    const line = summarise(BASE);
    expect(line).toContain("found 3");
    expect(line).toContain("accepted 3");
    expect(line).toContain("queued 0");
  });

  it("names discards only when there were some", () => {
    expect(summarise(BASE)).not.toContain("discarded");
    expect(summarise({ ...BASE, queue: { ...BASE.queue, discarded: 4 } })).toContain("discarded 4");
  });

  it("says when the run ran out of time, because the counts alone cannot", () => {
    expect(summarise({ ...BASE, budgetExhausted: true })).toContain("budget-exhausted");
  });

  it("says how many turns the scope left out, and nothing when it left out none", () => {
    expect(summarise(BASE)).not.toContain("out-of-scope");
    expect(summarise({ ...BASE, scan: { ...BASE.scan, turnsOutOfScope: 12 } })).toContain(
      "out-of-scope 12",
    );
  });

  it("says how many measurements carry a dimension, and nothing when none does", () => {
    expect(summarise(BASE)).not.toContain("attributed");
    expect(summarise({ ...BASE, scan: { ...BASE.scan, turnsAttributed: 2 } })).toContain(
      "attributed 2",
    );
  });

  it("names a failure of the attribution rules by its codes, like any other", () => {
    const line = summarise({
      ...BASE,
      failures: [
        { stage: "attribution", reason: "invalid-rules", count: 1, detail: "unknown-key" },
      ],
    });
    expect(line).toContain("attribution:invalid-rules 1");
  });

  it("names every skip reason and every failure, so nothing is invisible", () => {
    const line = summarise({
      ...BASE,
      skipped: [{ reason: "unparsable-line", count: 2 }],
      failures: [{ stage: "transport", reason: "unreachable", count: 1 }],
    });

    expect(line).toContain("skipped:unparsable-line 2");
    expect(line).toContain("transport:unreachable 1");
  });

  it("prints one physical line", () => {
    const line = summarise({
      ...BASE,
      skipped: [{ reason: "missing-key", count: 1 }],
      failures: [{ stage: "queue", reason: "unwritable-queue", count: 1 }],
    });
    expect(line).not.toContain("\n");
  });
});
