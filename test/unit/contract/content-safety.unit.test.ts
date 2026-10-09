import { describe, expect, it } from "vitest";
import {
  buildAttributor,
  parseAttributionRules,
  type Attributor,
} from "../../../src/attribution/attribution-rules.js";
import { extractUsageTurn } from "../../../src/claude-code/usage-extraction.js";
import {
  splitIntoBatches,
  CLAUDE_CODE_AGENT,
  type MeasurementEntry,
} from "../../../src/contract/ingest-contract.js";
import {
  DIMENSION_FIELDS,
  MEASUREMENT_ENTRY_FIELDS,
  TOKEN_FIELDS,
  projectMeasurement,
} from "../../../src/contract/measurement-projection.js";
import { emptyCursor } from "../../../src/cursor/scan-cursor.js";
import { collectMeasurements } from "../../../src/run/collect.js";
import { RunOutcomeAccumulator } from "../../../src/run/run-outcome.js";
import {
  MARKERS,
  MARKER_BRANCH,
  MARKER_BRANCH_TASK,
  markerTranscriptEvent,
  titleEvents,
} from "../support/transcripts.js";

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
 *
 * Since a repository can declare attribution rules (specs/attribution-rules/decision.md), one
 * thing derived from one of those fields may leave the machine: what a committed rule's named
 * groups capture of the branch name. The later suites hold the edges of that: a part of the
 * branch travels only when a rule captured it, the whole of it only inside a dimension's key,
 * and nothing else — a path, a session's name, a generated title — under any rule at all.
 */

const EVERY_MARKER = Object.values(MARKERS);
const TASK_FROM_BRANCH = {
  from: "branch",
  match: "^(?<task>[A-Z][0-9]{3})-",
  emit: [{ type: "task", key: "{task}" }],
};
const WHOLE_BRANCH = {
  from: "branch",
  match: "^(?<all>.+)$",
  emit: [{ type: "branch", key: "{all}" }],
};

function attributorOf(...rules: readonly unknown[]): Attributor {
  const parsed = parseAttributionRules(JSON.stringify({ version: 1, attribution: rules }));
  if (parsed.kind !== "rules") {
    throw new Error(`fixture rules must be valid, got ${parsed.code}`);
  }
  return buildAttributor(parsed.rules).attribute;
}

function entryUnder(attribute?: Attributor): MeasurementEntry {
  const extracted = extractUsageTurn(markerTranscriptEvent(), undefined, attribute);
  if (extracted.kind !== "turn") {
    throw new Error("fixture must extract to a turn");
  }
  return projectMeasurement(extracted.turn, "standard");
}

function serialise(entry: MeasurementEntry): string {
  const [batch] = splitIntoBatches(CLAUDE_CODE_AGENT, [entry], 200);
  return JSON.stringify(batch);
}

function occurrences(text: string, fragment: string): number {
  return text.split(fragment).length - 1;
}

describe("content safety: only counters and identifiers leave the machine", () => {
  const event = markerTranscriptEvent();
  const extracted = extractUsageTurn(event);
  if (extracted.kind !== "turn") {
    throw new Error("fixture must extract to a turn");
  }
  const entry = projectMeasurement(extracted.turn, "standard");

  it("carries no marker into the serialised batch", () => {
    const serialised = serialise(entry);

    for (const marker of EVERY_MARKER) {
      expect(serialised).not.toContain(marker);
    }
  });

  it("carries no marker into the extracted turn either — the boundary is extraction, not sending", () => {
    const serialised = JSON.stringify(extracted.turn);
    for (const marker of EVERY_MARKER) {
      expect(serialised).not.toContain(marker);
    }
  });

  it("has exactly the allowlisted fields and no others", () => {
    const withoutDimensions = MEASUREMENT_ENTRY_FIELDS.filter((field) => field !== "dimensions");
    expect(Object.keys(entry).sort()).toEqual([...withoutDimensions].sort());
    expect(Object.keys(entry.tokens).sort()).toEqual([...TOKEN_FIELDS].sort());
  });

  it("sends no dimensions, payload, project or user when the repository declared no rules", () => {
    for (const forbidden of ["dimensions", "payload", "projectId", "userId", "cwd", "gitBranch"]) {
      expect(entry).not.toHaveProperty(forbidden);
    }
    expect(serialise(entry)).not.toContain(MARKER_BRANCH_TASK);
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

describe("content safety: a rule that captures a part of the branch", () => {
  const entry = entryUnder(attributorOf(TASK_FROM_BRANCH));

  it("sends the part the rule captured", () => {
    expect(entry.dimensions).toEqual([{ type: "task", key: MARKER_BRANCH_TASK }]);
  });

  it("sends none of the rest of the branch, and no other marker", () => {
    const serialised = serialise(entry);
    for (const marker of EVERY_MARKER) {
      expect(serialised).not.toContain(marker);
    }
    expect(serialised).not.toContain(MARKER_BRANCH);
  });

  it("carries the branch no further than extraction: the turn holds the dimension, not the name", () => {
    const extracted = extractUsageTurn(
      markerTranscriptEvent(),
      undefined,
      attributorOf(TASK_FROM_BRANCH),
    );
    const serialised = JSON.stringify(extracted);

    expect(serialised).toContain(MARKER_BRANCH_TASK);
    for (const marker of EVERY_MARKER) {
      expect(serialised).not.toContain(marker);
    }
  });

  it("has exactly the allowlisted fields, dimensions among them, and no others", () => {
    expect(Object.keys(entry).sort()).toEqual([...MEASUREMENT_ENTRY_FIELDS].sort());
    for (const dimension of entry.dimensions ?? []) {
      expect(Object.keys(dimension).sort()).toEqual([...DIMENSION_FIELDS].sort());
    }
  });
});

describe("content safety: a rule that deliberately captures the whole branch", () => {
  const entry = entryUnder(attributorOf(WHOLE_BRANCH));
  const serialised = serialise(entry);

  it("sends the branch where the repository's rule put it, and nowhere else", () => {
    expect(entry.dimensions).toEqual([{ type: "branch", key: MARKER_BRANCH }]);
    expect(occurrences(serialised, MARKERS.branch)).toBe(1);
  });

  it("still sends no other marker — not the working directory, not a line of content", () => {
    for (const marker of EVERY_MARKER.filter((candidate) => candidate !== MARKERS.branch)) {
      expect(serialised).not.toContain(marker);
    }
  });
});

describe("content safety: what no rule can be made to send", () => {
  it.each(["cwd", "session", "slug", "entrypoint", "uuid", "path", "environment"])(
    "refuses a rule file whose rule reads %j, so there is no configuration that sends it",
    (from) => {
      const text = JSON.stringify({ version: 1, attribution: [{ ...WHOLE_BRANCH, from }] });
      expect(parseAttributionRules(text)).toEqual({ kind: "invalid", code: "unknown-source" });
    },
  );

  it("hands a rule nothing of the event but the branch", () => {
    const seen: unknown[] = [];
    extractUsageTurn(markerTranscriptEvent(), undefined, (input) => {
      seen.push(input);
      return [];
    });

    expect(seen).toEqual([{ branch: MARKER_BRANCH }]);
  });

  it("rebuilds a dimension by name, so nothing an attributor adds beside type and key travels", () => {
    const smuggling = (() => [
      { type: "task", key: "K123", cwd: MARKERS.cwd, weight: 1 },
    ]) as unknown as Attributor;

    const entry = entryUnder(smuggling);

    expect(entry.dimensions).toEqual([{ type: "task", key: "K123" }]);
    expect(serialise(entry)).not.toContain(MARKERS.cwd);
  });
});

describe("content safety: a session's name and its generated title never leave", () => {
  const titles = titleEvents();
  const rules = [
    ["no rules", undefined],
    ["a rule over a part of the branch", attributorOf(TASK_FROM_BRANCH)],
    ["a rule over the whole branch", attributorOf(WHOLE_BRANCH)],
  ] as const;

  it.each(titles.map((title) => [title.type, title] as const))(
    "does not take a %s event for a turn, nor for something it skipped",
    (_type, title) => {
      expect(extractUsageTurn(title, undefined, attributorOf(WHOLE_BRANCH))).toEqual({
        kind: "ignored",
      });
    },
  );

  it.each(rules)(
    "sends neither from a transcript that holds all three beside a turn, under %s",
    async (_name, attribute) => {
      const lines = [titles[0], markerTranscriptEvent(), titles[1], titles[2]];
      const outcome = new RunOutcomeAccumulator();

      const { entries } = await collectMeasurements(
        ["/t/session.jsonl"],
        emptyCursor(),
        "standard",
        outcome,
        {
          statFile: async () => ({ size: lines.length, mtimeMs: 1 }),
          readLines: async (_path, _from, onLine) => {
            lines.forEach((line) => onLine(line));
            return { offsetReached: lines.length, linesRead: lines.length, unparsable: 0 };
          },
          expired: () => false,
        },
        undefined,
        attribute,
      );

      const serialised = JSON.stringify(splitIntoBatches(CLAUDE_CODE_AGENT, entries, 200));
      expect(entries).toHaveLength(1);
      expect(outcome.build("collected", 0, false).skipped).toEqual([]);
      for (const marker of [MARKERS.customTitle, MARKERS.agentName, MARKERS.aiTitle]) {
        expect(serialised).not.toContain(marker);
      }
    },
  );
});
