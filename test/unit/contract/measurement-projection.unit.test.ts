import { describe, expect, it } from "vitest";
import type { UsageTurn } from "../../../src/claude-code/usage-extraction.js";
import {
  DIMENSION_FIELDS,
  MEASUREMENT_ENTRY_FIELDS,
  measurementTotal,
  projectMeasurement,
} from "../../../src/contract/measurement-projection.js";

const turn: UsageTurn = {
  messageId: "msg_key",
  occurredAt: "2026-08-20T10:00:00.000Z",
  sessionId: "session-1",
  model: "claude-opus-5",
  tokens: { input: 1, output: 2, cacheWrite5m: 3, cacheWrite1h: 4, cacheRead: 5 },
};

describe("projectMeasurement", () => {
  it("uses the message id as the idempotency key, unchanged", () => {
    expect(projectMeasurement(turn, "standard").idempotencyKey).toBe("msg_key");
  });

  it("carries the tier it is given rather than deriving one it has no price table for", () => {
    expect(projectMeasurement(turn, "intro").pricingTier).toBe("intro");
  });

  it("passes the occurrence instant through verbatim, offset and all", () => {
    const withOffset: UsageTurn = { ...turn, occurredAt: "2026-08-20T12:00:00.000+02:00" };
    expect(projectMeasurement(withOffset, "standard").occurredAt).toBe(
      "2026-08-20T12:00:00.000+02:00",
    );
  });

  it("omits sessionId entirely when the turn has none — the schema refuses null and empty", () => {
    const anonymous: UsageTurn = {
      messageId: turn.messageId,
      occurredAt: turn.occurredAt,
      model: turn.model,
      tokens: turn.tokens,
    };
    const entry = projectMeasurement(anonymous, "standard");
    expect("sessionId" in entry).toBe(false);
  });

  it("copies all five buckets", () => {
    expect(projectMeasurement(turn, "standard").tokens).toEqual({
      input: 1,
      output: 2,
      cacheWrite5m: 3,
      cacheWrite1h: 4,
      cacheRead: 5,
    });
  });
});

describe("measurementTotal", () => {
  it("is the sum of the five buckets, which is what breaks a tie between duplicates", () => {
    expect(measurementTotal(projectMeasurement(turn, "standard"))).toBe(15);
  });
});

describe("projectMeasurement: dimensions", () => {
  const dimensions = [
    { type: "task", key: "K123" },
    { type: "checkout", key: "laptop-a" },
  ];

  it("writes a turn's dimensions out, in order, each with exactly a type and a key", () => {
    const entry = projectMeasurement({ ...turn, dimensions }, "standard");

    expect(entry.dimensions).toEqual(dimensions);
    expect(Object.keys(entry)).toContain("dimensions");
    for (const dimension of entry.dimensions ?? []) {
      expect(Object.keys(dimension).sort()).toEqual([...DIMENSION_FIELDS].sort());
    }
  });

  it("builds new objects rather than passing the turn's own through", () => {
    const entry = projectMeasurement({ ...turn, dimensions }, "standard");

    expect(entry.dimensions).not.toBe(dimensions);
    expect(entry.dimensions?.[0]).not.toBe(dimensions[0]);
  });

  it("omits the key entirely for a turn with no dimensions, and for one with an empty list", () => {
    expect("dimensions" in projectMeasurement(turn, "standard")).toBe(false);
    expect("dimensions" in projectMeasurement({ ...turn, dimensions: [] }, "standard")).toBe(false);
  });

  it("carries dimensions on a turn with no session id, and still omits the session id", () => {
    const anonymous: UsageTurn = {
      messageId: turn.messageId,
      occurredAt: turn.occurredAt,
      model: turn.model,
      tokens: turn.tokens,
      dimensions,
    };
    const entry = projectMeasurement(anonymous, "standard");

    expect("sessionId" in entry).toBe(false);
    expect(entry.dimensions).toEqual(dimensions);
  });

  it("declares dimensions among the fields of a measurement, and a dimension's own two", () => {
    expect(MEASUREMENT_ENTRY_FIELDS).toContain("dimensions");
    expect([...DIMENSION_FIELDS].sort()).toEqual(["key", "type"]);
  });
});
