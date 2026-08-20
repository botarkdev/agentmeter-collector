import { describe, expect, it } from "vitest";
import type { UsageTurn } from "../../../src/claude-code/usage-extraction.js";
import {
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
