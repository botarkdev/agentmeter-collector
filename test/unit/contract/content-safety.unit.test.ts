import { describe, expect, it } from "vitest";
import { extractUsageTurn } from "../../../src/claude-code/usage-extraction.js";
import { splitIntoBatches, CLAUDE_CODE_AGENT } from "../../../src/contract/ingest-contract.js";
import {
  MEASUREMENT_ENTRY_FIELDS,
  TOKEN_FIELDS,
  projectMeasurement,
} from "../../../src/contract/measurement-projection.js";
import { MARKERS, markerTranscriptEvent } from "../support/transcripts.js";

/**
 * FR-026: the content-safety property is a test, not a comment.
 *
 * The fixture carries a distinctive marker in every content-bearing field the real transcript
 * format is known to have — message content, tool input, tool result, `cwd`, `gitBranch`, `slug`,
 * `entrypoint`, `error`, `uuid` — plus a field invented here to stand in for one a future Claude
 * Code version will add. If any of them reaches the serialised request body, this fails.
 *
 * It fails for the right reason: adding a single field to `projectMeasurement` that copies
 * anything from the event makes it red, which was observed before this file was finished.
 */
describe("content safety: only counters and identifiers leave the machine", () => {
  const event = markerTranscriptEvent();
  const extracted = extractUsageTurn(event);
  if (extracted.kind !== "turn") {
    throw new Error("fixture must extract to a turn");
  }
  const entry = projectMeasurement(extracted.turn, "standard");

  it("carries no marker into the serialised batch", () => {
    const [batch] = splitIntoBatches(CLAUDE_CODE_AGENT, [entry], 200);
    const serialised = JSON.stringify(batch);

    for (const marker of Object.values(MARKERS)) {
      expect(serialised).not.toContain(marker);
    }
  });

  it("carries no marker into the extracted turn either — the boundary is extraction, not sending", () => {
    const serialised = JSON.stringify(extracted.turn);
    for (const marker of Object.values(MARKERS)) {
      expect(serialised).not.toContain(marker);
    }
  });

  it("has exactly the allowlisted fields and no others", () => {
    expect(Object.keys(entry).sort()).toEqual([...MEASUREMENT_ENTRY_FIELDS].sort());
    expect(Object.keys(entry.tokens).sort()).toEqual([...TOKEN_FIELDS].sort());
  });

  it("sends no dimensions, payload, project or user — none of which this feature derives", () => {
    for (const forbidden of ["dimensions", "payload", "projectId", "userId", "cwd", "gitBranch"]) {
      expect(entry).not.toHaveProperty(forbidden);
    }
  });

  it("keeps the counters it is supposed to carry, so the test above is not passing vacuously", () => {
    expect(entry.tokens).toEqual({
      input: 5,
      output: 7,
      cacheWrite5m: 13,
      cacheWrite1h: 0,
      cacheRead: 11,
    });
    expect(entry.idempotencyKey).toBe("msg_marker");
    expect(entry.sessionId).toBe("session-marker");
  });
});
