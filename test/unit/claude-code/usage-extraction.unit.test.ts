import { describe, expect, it } from "vitest";
import { extractUsageTurn, totalTokens } from "../../../src/claude-code/usage-extraction.js";
import type { Attributor } from "../../../src/attribution/attribution-rules.js";
import { assistantTurn } from "../support/transcripts.js";

describe("extractUsageTurn", () => {
  it("carries exactly the six things a measurement needs out of a transcript event", () => {
    const result = extractUsageTurn(
      assistantTurn({
        messageId: "msg_abc",
        sessionId: "session-9",
        timestamp: "2026-08-20T11:22:33.444Z",
        model: "claude-sonnet-5",
        input: 2,
        output: 348,
        cacheRead: 20628,
        cacheWrite5m: 0,
        cacheWrite1h: 7028,
      }),
    );

    expect(result).toEqual({
      kind: "turn",
      turn: {
        messageId: "msg_abc",
        occurredAt: "2026-08-20T11:22:33.444Z",
        sessionId: "session-9",
        model: "claude-sonnet-5",
        tokens: {
          input: 2,
          output: 348,
          cacheWrite5m: 0,
          cacheWrite1h: 7028,
          cacheRead: 20628,
        },
      },
    });
  });

  it("omits sessionId entirely rather than carrying an empty one", () => {
    const result = extractUsageTurn(assistantTurn({ sessionId: null }));
    expect(result.kind).toBe("turn");
    if (result.kind !== "turn") return;
    expect("sessionId" in result.turn).toBe(false);
  });

  it("accepts the snake_case session_id some transcript lines carry instead", () => {
    const event = assistantTurn({ sessionId: null });
    event.session_id = "snake-session";
    const result = extractUsageTurn(event);
    expect(result.kind === "turn" && result.turn.sessionId).toBe("snake-session");
  });

  describe("what it ignores without reporting", () => {
    it.each([
      ["a user turn", { type: "user", message: { usage: { input_tokens: 1 } } }],
      ["an assistant turn with no usage", { type: "assistant", message: { id: "msg_x" } }],
      ["a summary line", { type: "summary", summary: "text" }],
      ["a bare string", "not an object"],
      ["null", null],
      ["an array", [1, 2, 3]],
    ])("ignores %s", (_label, value) => {
      expect(extractUsageTurn(value)).toEqual({ kind: "ignored" });
    });
  });

  describe("what it skips, with a reason", () => {
    it("skips a turn with no message id — there is no stable key for it", () => {
      expect(extractUsageTurn(assistantTurn({ messageId: null }))).toEqual({
        kind: "skipped",
        reason: "missing-key",
      });
    });

    it("skips a turn with no timestamp — it cannot be placed in time", () => {
      expect(extractUsageTurn(assistantTurn({ timestamp: null }))).toEqual({
        kind: "skipped",
        reason: "missing-timestamp",
      });
    });

    it("skips a turn with no model", () => {
      expect(extractUsageTurn(assistantTurn({ model: null }))).toEqual({
        kind: "skipped",
        reason: "missing-model",
      });
    });

    it.each([
      ["a string counter", "12"],
      ["a negative counter", -1],
      ["a fractional counter", 1.5],
      ["NaN", Number.NaN],
      ["a boolean", true],
    ])("skips a turn whose input count is %s", (_label, value) => {
      const event = assistantTurn();
      (event.message as { usage: Record<string, unknown> }).usage.input_tokens = value;
      expect(extractUsageTurn(event)).toEqual({
        kind: "skipped",
        reason: "invalid-token-counts",
      });
    });

    it("skips a turn whose itemised cache-write count is invalid", () => {
      const event = assistantTurn();
      const usage = (event.message as { usage: Record<string, unknown> }).usage;
      (usage.cache_creation as Record<string, unknown>).ephemeral_5m_input_tokens = -3;
      expect(extractUsageTurn(event)).toEqual({
        kind: "skipped",
        reason: "invalid-token-counts",
      });
    });

    it("skips a turn whose flat cache-creation count is invalid", () => {
      const event = assistantTurn({
        omitItemisedCacheCreation: true,
        flatCacheCreation: Number.NaN,
      });
      expect(extractUsageTurn(event)).toEqual({
        kind: "skipped",
        reason: "invalid-token-counts",
      });
    });

    it("skips a turn that measures nothing — which is what Claude Code's <synthetic> turns are", () => {
      const event = assistantTurn({
        model: "<synthetic>",
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
      });
      expect(extractUsageTurn(event)).toEqual({ kind: "skipped", reason: "zero-token-turn" });
    });
  });

  describe("token bucket derivation", () => {
    it("treats an absent counter as zero, exactly as the reference implementation does", () => {
      const event = {
        type: "assistant",
        timestamp: "2026-08-20T10:00:00.000Z",
        message: { id: "msg_sparse", model: "claude-opus-5", usage: { output_tokens: 9 } },
      };
      const result = extractUsageTurn(event);
      expect(result.kind === "turn" && result.turn.tokens).toEqual({
        input: 0,
        output: 9,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        cacheRead: 0,
      });
    });

    it("treats a null counter as zero, not as malformed", () => {
      const event = assistantTurn();
      (event.message as { usage: Record<string, unknown> }).usage.cache_read_input_tokens = null;
      const result = extractUsageTurn(event);
      expect(result.kind === "turn" && result.turn.tokens.cacheRead).toBe(0);
    });

    it("prefers the itemised cache-creation counts over the flat total", () => {
      // Real transcripts disagree between the two in a small number of turns; the itemised values
      // win, which is the reference implementation's behaviour.
      const event = assistantTurn({ cacheWrite5m: 100, cacheWrite1h: 200, flatCacheCreation: 999 });
      const result = extractUsageTurn(event);
      expect(result.kind === "turn" && result.turn.tokens).toMatchObject({
        cacheWrite5m: 100,
        cacheWrite1h: 200,
      });
    });

    it("derives the 5-minute count from the flat total when only the flat total is present", () => {
      const event = assistantTurn({ omitItemisedCacheCreation: true, flatCacheCreation: 700 });
      const result = extractUsageTurn(event);
      expect(result.kind === "turn" && result.turn.tokens).toMatchObject({
        cacheWrite5m: 700,
        cacheWrite1h: 0,
      });
    });

    it("floors the derived 5-minute count at zero when the 1-hour count exceeds the flat total", () => {
      const event = assistantTurn({ flatCacheCreation: 10, cacheWrite1h: 50 });
      // Itemised 5m is present in this fixture, so remove it to force the fallback path while
      // keeping the itemised 1-hour count.
      const usage = (event.message as { usage: Record<string, unknown> }).usage;
      delete (usage.cache_creation as Record<string, unknown>).ephemeral_5m_input_tokens;
      const result = extractUsageTurn(event);
      expect(result.kind === "turn" && result.turn.tokens).toMatchObject({
        cacheWrite5m: 0,
        cacheWrite1h: 50,
      });
    });

    it("does not read usage.service_tier, which is a different thing from a pricing tier", () => {
      const event = assistantTurn();
      (event.message as { usage: Record<string, unknown> }).usage.service_tier = "priority";
      const result = extractUsageTurn(event);
      expect(JSON.stringify(result)).not.toContain("priority");
    });
  });
});

describe("totalTokens", () => {
  it("sums all five buckets", () => {
    expect(
      totalTokens({ input: 1, output: 2, cacheWrite5m: 4, cacheWrite1h: 8, cacheRead: 16 }),
    ).toBe(31);
  });
});
describe("extractUsageTurn: with a scope", () => {
  const inside = (directory: string | undefined): boolean => directory === "/work/acme/widgets";

  it("hands the turn's working directory to the scope and keeps a turn it accepts", () => {
    const seen: (string | undefined)[] = [];
    const result = extractUsageTurn(assistantTurn({ cwd: "/work/acme/widgets" }), (directory) => {
      seen.push(directory);
      return inside(directory);
    });

    expect(seen).toEqual(["/work/acme/widgets"]);
    expect(result.kind).toBe("turn");
  });

  it("carries nothing of the working directory in the turn it returns", () => {
    const result = extractUsageTurn(assistantTurn({ cwd: "/work/acme/widgets" }), inside);

    expect(JSON.stringify(result)).not.toContain("widgets");
  });

  it("reports a turn the scope rejects as out of scope, not as a skip", () => {
    expect(extractUsageTurn(assistantTurn({ cwd: "/work/acme/gadgets" }), inside)).toEqual({
      kind: "out-of-scope",
    });
  });

  it("asks the scope with no directory when the turn records none", () => {
    expect(extractUsageTurn(assistantTurn(), inside)).toEqual({ kind: "out-of-scope" });
  });

  it("does not report another repository's malformed turn as this run's skip", () => {
    const malformed = assistantTurn({ cwd: "/work/acme/gadgets", model: null });

    expect(extractUsageTurn(malformed, inside)).toEqual({ kind: "out-of-scope" });
    expect(extractUsageTurn(malformed)).toEqual({ kind: "skipped", reason: "missing-model" });
  });

  it("does not ask the scope about a line that is not usage at all", () => {
    let asked = 0;
    const result = extractUsageTurn({ type: "user", cwd: "/work/acme/gadgets" }, () => {
      asked += 1;
      return false;
    });

    expect(result).toEqual({ kind: "ignored" });
    expect(asked).toBe(0);
  });
});

describe("extractUsageTurn: attribution", () => {
  const taskOf: Attributor = ({ branch }) =>
    branch === undefined ? [] : [{ type: "task", key: branch.slice(0, 4) }];

  it("hands the attribution function the branch the turn records, and nothing else", () => {
    const seen: unknown[] = [];
    extractUsageTurn(
      assistantTurn({ gitBranch: "K123-add-export", cwd: "/work/acme/widgets" }),
      undefined,
      (input) => {
        seen.push(input);
        return [];
      },
    );

    expect(seen).toEqual([{ branch: "K123-add-export" }]);
  });

  it("hands it no branch at all for a turn that records none, or an empty one", () => {
    const seen: unknown[] = [];
    const record: Attributor = (input) => {
      seen.push(input);
      return [];
    };
    extractUsageTurn(assistantTurn(), undefined, record);
    extractUsageTurn(assistantTurn({ gitBranch: "" }), undefined, record);

    expect(seen).toEqual([{}, {}]);
  });

  it("carries the dimensions it was given on the turn, and never the branch they came from", () => {
    const result = extractUsageTurn(
      assistantTurn({ gitBranch: "K123-add-export" }),
      undefined,
      taskOf,
    );

    expect(result.kind === "turn" && result.turn.dimensions).toEqual([
      { type: "task", key: "K123" },
    ]);
    expect(JSON.stringify(result)).not.toContain("add-export");
  });

  it("omits dimensions entirely when the rules gave the turn none", () => {
    const result = extractUsageTurn(assistantTurn({ gitBranch: "main" }), undefined, () => []);
    expect(result.kind).toBe("turn");
    if (result.kind !== "turn") return;
    expect("dimensions" in result.turn).toBe(false);
  });

  it("omits dimensions entirely when no attribution function is given, as before", () => {
    const result = extractUsageTurn(assistantTurn({ gitBranch: "K123-add-export" }));
    expect(result.kind).toBe("turn");
    if (result.kind !== "turn") return;
    expect("dimensions" in result.turn).toBe(false);
  });

  it("keeps a turn with no session id and carries its dimensions", () => {
    const result = extractUsageTurn(
      assistantTurn({ sessionId: null, gitBranch: "K123-add-export" }),
      undefined,
      taskOf,
    );
    expect(result.kind).toBe("turn");
    if (result.kind !== "turn") return;
    expect("sessionId" in result.turn).toBe(false);
    expect(result.turn.dimensions).toEqual([{ type: "task", key: "K123" }]);
  });

  it("does not ask about a turn it is not going to report", () => {
    let asked = 0;
    const count: Attributor = () => {
      asked += 1;
      return [];
    };
    extractUsageTurn(assistantTurn({ cwd: "/elsewhere" }), () => false, count);
    extractUsageTurn(assistantTurn({ model: null }), undefined, count);
    extractUsageTurn({ type: "user" }, undefined, count);

    expect(asked).toBe(0);
  });
});
