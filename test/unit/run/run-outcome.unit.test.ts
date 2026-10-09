import { describe, expect, it } from "vitest";
import { RunOutcomeAccumulator } from "../../../src/run/run-outcome.js";

describe("RunOutcomeAccumulator", () => {
  it("reports zeros rather than omissions for a run that did nothing", () => {
    const outcome = new RunOutcomeAccumulator().build("collected", 12, false);

    expect(outcome).toEqual({
      status: "collected",
      scan: {
        filesConsidered: 0,
        filesRead: 0,
        linesRead: 0,
        turnsFound: 0,
        turnsOutOfScope: 0,
        turnsAttributed: 0,
        measurements: 0,
        duplicatesCollapsed: 0,
      },
      delivery: { batchesSent: 0, accepted: 0, deduplicated: 0, rejected: 0 },
      queue: { enqueued: 0, remaining: 0, discarded: 0 },
      skipped: [],
      failures: [],
      durationMs: 12,
      budgetExhausted: false,
    });
  });

  it("merges repeated skips of the same reason into one counted record", () => {
    const accumulator = new RunOutcomeAccumulator();
    accumulator.skip("unparsable-line");
    accumulator.skip("unparsable-line", 4);
    accumulator.skip("missing-key");

    expect(accumulator.build("collected", 0, false).skipped).toEqual([
      { reason: "unparsable-line", count: 5 },
      { reason: "missing-key", count: 1 },
    ]);
  });

  it("ignores a skip of nothing, so a clean file does not create an empty record", () => {
    const accumulator = new RunOutcomeAccumulator();
    accumulator.skip("unparsable-line", 0);
    expect(accumulator.build("collected", 0, false).skipped).toEqual([]);
  });

  it("merges identical failures instead of emitting one record per occurrence", () => {
    const accumulator = new RunOutcomeAccumulator();
    for (let index = 0; index < 500; index += 1) {
      accumulator.fail("scan", "unreadable-file");
    }

    expect(accumulator.build("collected", 0, false).failures).toEqual([
      { stage: "scan", reason: "unreadable-file", count: 500 },
    ]);
  });

  it("keeps failures with different details apart", () => {
    const accumulator = new RunOutcomeAccumulator();
    accumulator.fail("transport", "rejected-permanently", "VALIDATION_FAILED");
    accumulator.fail("transport", "rejected-permanently", "BODY_TOO_LARGE");
    accumulator.fail("transport", "rejected-permanently", "VALIDATION_FAILED");

    expect(accumulator.build("collected", 0, false).failures).toEqual([
      { stage: "transport", reason: "rejected-permanently", count: 2, detail: "VALIDATION_FAILED" },
      { stage: "transport", reason: "rejected-permanently", count: 1, detail: "BODY_TOO_LARGE" },
    ]);
  });

  it("leaves detail ABSENT rather than null when there is none", () => {
    const accumulator = new RunOutcomeAccumulator();
    accumulator.fail("queue", "unwritable-queue");
    const [failure] = accumulator.build("collected", 0, false).failures;
    expect("detail" in failure!).toBe(false);
  });

  it("carries every counter it was given through to the built outcome", () => {
    const accumulator = new RunOutcomeAccumulator();
    accumulator.filesConsidered = 9;
    accumulator.filesRead = 8;
    accumulator.linesRead = 7;
    accumulator.turnsFound = 6;
    accumulator.turnsOutOfScope = 3;
    accumulator.turnsAttributed = 2;
    accumulator.measurements = 5;
    accumulator.duplicatesCollapsed = 4;
    accumulator.batchesSent = 3;
    accumulator.accepted = 30;
    accumulator.deduplicated = 20;
    accumulator.rejected = 10;
    accumulator.enqueued = 2;
    accumulator.remaining = 1;
    accumulator.discarded = 11;

    const outcome = accumulator.build("collected", 99, true);
    expect(outcome.scan).toEqual({
      filesConsidered: 9,
      filesRead: 8,
      linesRead: 7,
      turnsFound: 6,
      turnsOutOfScope: 3,
      turnsAttributed: 2,
      measurements: 5,
      duplicatesCollapsed: 4,
    });
    expect(outcome.delivery).toEqual({
      batchesSent: 3,
      accepted: 30,
      deduplicated: 20,
      rejected: 10,
    });
    expect(outcome.queue).toEqual({ enqueued: 2, remaining: 1, discarded: 11 });
    expect(outcome.budgetExhausted).toBe(true);
  });

  it("records what went wrong with a repository's attribution rules as a stage of its own", () => {
    const accumulator = new RunOutcomeAccumulator();
    accumulator.fail("attribution", "invalid-rules", "unknown-key");
    accumulator.fail("attribution", "unreadable-rules");
    accumulator.fail("attribution", "rule-timeout");

    expect(accumulator.build("collected", 1, false).failures).toEqual([
      { stage: "attribution", reason: "invalid-rules", count: 1, detail: "unknown-key" },
      { stage: "attribution", reason: "unreadable-rules", count: 1 },
      { stage: "attribution", reason: "rule-timeout", count: 1 },
    ]);
  });
});
