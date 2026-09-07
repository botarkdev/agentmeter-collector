import { describe, expect, it } from "vitest";
import {
  CLAUDE_CODE_AGENT,
  INGEST_PATH,
  ingestUrl,
  readAcceptance,
  readServiceError,
  splitIntoBatches,
  type MeasurementEntry,
} from "../../../src/contract/ingest-contract.js";

function entry(key: string): MeasurementEntry {
  return {
    idempotencyKey: key,
    occurredAt: "2026-08-20T10:00:00.000Z",
    model: "claude-opus-5",
    pricingTier: "standard",
    tokens: { input: 1, output: 1, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 },
  };
}

describe("ingestUrl", () => {
  it("appends the versioned ingest path to the configured base", () => {
    // `example.invalid` is reserved by RFC 2606 and can never resolve — a placeholder, never a
    // real host (Constitution, "Environment-specific values are never committed").
    expect(ingestUrl("https://collector.invalid")).toBe(`https://collector.invalid${INGEST_PATH}`);
  });

  it("tolerates trailing slashes rather than producing a double slash nobody diagnoses", () => {
    expect(ingestUrl("https://collector.invalid///")).toBe(
      `https://collector.invalid${INGEST_PATH}`,
    );
  });
});

describe("splitIntoBatches", () => {
  it("never produces an empty batch", () => {
    expect(splitIntoBatches(CLAUDE_CODE_AGENT, [], 200)).toEqual([]);
  });

  it.each([
    [1, 3],
    [2, 2],
    [3, 1],
    [4, 1],
    [200, 1],
  ])("splits 3 entries at size %i into %i batches", (size, expected) => {
    const batches = splitIntoBatches(CLAUDE_CODE_AGENT, [entry("a"), entry("b"), entry("c")], size);
    expect(batches).toHaveLength(expected);
    expect(batches.every((batch) => batch.measurements.length > 0)).toBe(true);
  });

  it("preserves every entry exactly once, in order", () => {
    const entries = Array.from({ length: 17 }, (_, index) => entry(`key-${index}`));
    const keys = splitIntoBatches(CLAUDE_CODE_AGENT, entries, 5).flatMap((batch) =>
      batch.measurements.map((measurement) => measurement.idempotencyKey),
    );
    expect(keys).toEqual(entries.map((each) => each.idempotencyKey));
  });

  it("names the agent on every batch", () => {
    const batches = splitIntoBatches(CLAUDE_CODE_AGENT, [entry("a"), entry("b")], 1);
    expect(batches.map((batch) => batch.agent)).toEqual(["claude-code", "claude-code"]);
  });

  it("treats a nonsensical batch size as one rather than looping forever", () => {
    expect(splitIntoBatches(CLAUDE_CODE_AGENT, [entry("a"), entry("b")], 0)).toHaveLength(2);
  });
});

describe("readAcceptance", () => {
  it("recognises the documented success body", () => {
    expect(readAcceptance({ accepted: 3, deduplicated: 1, rejected: 0, cost: {} })).toEqual({
      accepted: 3,
      deduplicated: 1,
      rejected: 0,
    });
  });

  it.each([
    ["a proxy's HTML error page parsed as text", "<html>oops</html>"],
    ["null", null],
    ["an array", []],
    ["a body missing a count", { accepted: 1, deduplicated: 0 }],
    ["a body whose counts are strings", { accepted: "1", deduplicated: "0", rejected: "0" }],
  ])("refuses to read delivery out of %s", (_label, body) => {
    expect(readAcceptance(body)).toBeUndefined();
  });
});

describe("readServiceError", () => {
  it("reads the documented error shape", () => {
    expect(readServiceError({ code: "VALIDATION_FAILED", action: "FIX_AND_RETRY" })).toEqual({
      code: "VALIDATION_FAILED",
      action: "FIX_AND_RETRY",
    });
  });

  it("ignores an action outside the closed set", () => {
    expect(readServiceError({ code: "X", action: "PANIC" })).toEqual({ code: "X" });
  });

  it("returns nothing readable for a body that is not the error contract", () => {
    expect(readServiceError("gateway timeout")).toEqual({});
    expect(readServiceError({ message: "no code here" })).toEqual({});
  });
});
