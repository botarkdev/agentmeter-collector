import { describe, expect, it } from "vitest";
import { collectMeasurements, type CollectDependencies } from "../../../src/run/collect.js";
import { emptyCursor, type ScanCursor } from "../../../src/cursor/scan-cursor.js";
import { RunOutcomeAccumulator } from "../../../src/run/run-outcome.js";
import { repositoryScope } from "../../../src/scope/turn-scope.js";
import type { Attributor } from "../../../src/attribution/attribution-rules.js";
import { assistantTurn } from "../support/transcripts.js";

/** An in-memory filesystem: `path -> lines`. Every dependency of `collectMeasurements` is
 * injected, so nothing here touches a disk. */
function depsFor(
  contents: Record<string, readonly unknown[]>,
  overrides: Partial<CollectDependencies> = {},
): CollectDependencies {
  return {
    statFile: async (path) => {
      if (!(path in contents)) {
        throw new Error("no such file");
      }
      return { size: contents[path]!.length, mtimeMs: 1 };
    },
    readLines: async (path, _from, onLine) => {
      const lines = contents[path] ?? [];
      for (const line of lines) {
        onLine(line);
      }
      return { offsetReached: lines.length, linesRead: lines.length, unparsable: 0 };
    },
    expired: () => false,
    ...overrides,
  };
}

const turnA = assistantTurn({ messageId: "msg_a", input: 1, output: 1 });
const turnB = assistantTurn({ messageId: "msg_b", input: 2, output: 2 });

describe("collectMeasurements", () => {
  it("produces one measurement per distinct turn", async () => {
    const outcome = new RunOutcomeAccumulator();
    const files = ["/t/a.jsonl"];
    const result = await collectMeasurements(
      files,
      emptyCursor(),
      "standard",
      outcome,
      depsFor({ "/t/a.jsonl": [turnA, turnB] }),
    );

    expect(result.entries.map((entry) => entry.idempotencyKey).sort()).toEqual(["msg_a", "msg_b"]);
    expect(outcome.turnsFound).toBe(2);
    expect(outcome.measurements).toBe(2);
  });

  it("collapses the same turn appearing twice in one file", async () => {
    const outcome = new RunOutcomeAccumulator();
    const result = await collectMeasurements(
      ["/t/a.jsonl"],
      emptyCursor(),
      "standard",
      outcome,
      depsFor({ "/t/a.jsonl": [turnA, turnA] }),
    );

    expect(result.entries).toHaveLength(1);
    expect(outcome.duplicatesCollapsed).toBe(1);
  });

  it("collapses the same turn appearing in two different files under two different sessions", async () => {
    // This is what a RESUMED session looks like: the same message id, rewritten into a new
    // transcript under a new session id. Charging it twice is the failure this prevents.
    const outcome = new RunOutcomeAccumulator();
    const original = assistantTurn({ messageId: "msg_shared", sessionId: "session-1" });
    const rewritten = assistantTurn({ messageId: "msg_shared", sessionId: "session-2" });

    const result = await collectMeasurements(
      ["/t/a.jsonl", "/t/b.jsonl"],
      emptyCursor(),
      "standard",
      outcome,
      depsFor({ "/t/a.jsonl": [original], "/t/b.jsonl": [rewritten] }),
    );

    expect(result.entries).toHaveLength(1);
  });

  describe("when duplicates disagree about the counts", () => {
    // Observed in real transcripts: a partial record written first, the complete one after.
    const partial = assistantTurn({
      messageId: "msg_p",
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite1h: 714,
    });
    const complete = assistantTurn({
      messageId: "msg_p",
      input: 2,
      output: 203,
      cacheRead: 995_198,
      cacheWrite1h: 714,
    });

    it.each([
      ["partial first", [partial, complete]],
      ["complete first", [complete, partial]],
    ])("keeps the complete counts regardless of read order (%s)", async (_label, lines) => {
      const outcome = new RunOutcomeAccumulator();
      const result = await collectMeasurements(
        ["/t/a.jsonl"],
        emptyCursor(),
        "standard",
        outcome,
        depsFor({ "/t/a.jsonl": lines }),
      );

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]!.tokens).toMatchObject({ output: 203, cacheRead: 995_198 });
    });
  });

  it("counts skipped turns by reason rather than dropping them silently", async () => {
    const outcome = new RunOutcomeAccumulator();
    await collectMeasurements(
      ["/t/a.jsonl"],
      emptyCursor(),
      "standard",
      outcome,
      depsFor({
        "/t/a.jsonl": [
          turnA,
          assistantTurn({ messageId: null }),
          assistantTurn({ messageId: "msg_z", timestamp: null }),
          { type: "user", message: {} },
        ],
      }),
    );

    const built = outcome.build("collected", 0, false);
    expect(built.skipped).toEqual(
      expect.arrayContaining([
        { reason: "missing-key", count: 1 },
        { reason: "missing-timestamp", count: 1 },
      ]),
    );
  });

  it("records a file it cannot stat as a failure and keeps going with the others", async () => {
    const outcome = new RunOutcomeAccumulator();
    const result = await collectMeasurements(
      ["/t/missing.jsonl", "/t/a.jsonl"],
      emptyCursor(),
      "standard",
      outcome,
      depsFor({ "/t/a.jsonl": [turnA] }),
    );

    expect(result.entries).toHaveLength(1);
    expect(outcome.build("collected", 0, false).failures).toEqual([
      { stage: "scan", reason: "unreadable-file", count: 1 },
    ]);
  });

  it("records a file it cannot read as a failure and keeps going", async () => {
    const outcome = new RunOutcomeAccumulator();
    const deps = depsFor(
      { "/t/a.jsonl": [turnA], "/t/b.jsonl": [turnB] },
      {
        readLines: async (path, _from, onLine) => {
          if (path === "/t/a.jsonl") {
            throw new Error("permission denied");
          }
          onLine(turnB);
          return { offsetReached: 1, linesRead: 1, unparsable: 0 };
        },
      },
    );

    const result = await collectMeasurements(
      ["/t/a.jsonl", "/t/b.jsonl"],
      emptyCursor(),
      "standard",
      outcome,
      deps,
    );

    expect(result.entries.map((entry) => entry.idempotencyKey)).toEqual(["msg_b"]);
    expect(outcome.build("collected", 0, false).failures).toEqual([
      { stage: "scan", reason: "unreadable-file", count: 1 },
    ]);
  });

  it("does not record a cursor entry for a file it failed to read", async () => {
    const outcome = new RunOutcomeAccumulator();
    const deps = depsFor(
      { "/t/a.jsonl": [turnA] },
      {
        readLines: async () => {
          throw new Error("boom");
        },
      },
    );

    const result = await collectMeasurements(
      ["/t/a.jsonl"],
      emptyCursor(),
      "standard",
      outcome,
      deps,
    );
    expect(result.nextCursor.files).toEqual({});
  });

  it("skips a file the cursor says is unchanged, and keeps its recorded position", async () => {
    const outcome = new RunOutcomeAccumulator();
    const cursor: ScanCursor = {
      version: 1,
      files: { "/t/a.jsonl": { size: 1, mtimeMs: 1, offset: 1 } },
    };

    const result = await collectMeasurements(
      ["/t/a.jsonl"],
      cursor,
      "standard",
      outcome,
      depsFor({ "/t/a.jsonl": [turnA] }),
    );

    expect(result.entries).toEqual([]);
    expect(outcome.filesRead).toBe(0);
    expect(result.nextCursor.files["/t/a.jsonl"]).toEqual({ size: 1, mtimeMs: 1, offset: 1 });
  });

  it("stops between files once the budget is spent, leaving the rest for the next run", async () => {
    const outcome = new RunOutcomeAccumulator();
    let filesStarted = 0;
    const deps = depsFor(
      { "/t/a.jsonl": [turnA], "/t/b.jsonl": [turnB] },
      {
        // Expires as soon as the first file has been read — asserted through this counter, never
        // through elapsed real time.
        expired: () => filesStarted >= 1,
        readLines: async (path, _from, onLine) => {
          filesStarted += 1;
          onLine(path === "/t/a.jsonl" ? turnA : turnB);
          return { offsetReached: 1, linesRead: 1, unparsable: 0 };
        },
      },
    );

    const result = await collectMeasurements(
      ["/t/a.jsonl", "/t/b.jsonl"],
      emptyCursor(),
      "standard",
      outcome,
      deps,
    );

    expect(result.entries.map((entry) => entry.idempotencyKey)).toEqual(["msg_a"]);
    expect(Object.keys(result.nextCursor.files)).toEqual(["/t/a.jsonl"]);
  });

  it("carries the configured pricing tier onto every measurement", async () => {
    const outcome = new RunOutcomeAccumulator();
    const result = await collectMeasurements(
      ["/t/a.jsonl"],
      emptyCursor(),
      "intro",
      outcome,
      depsFor({ "/t/a.jsonl": [turnA, turnB] }),
    );

    expect(result.entries.every((entry) => entry.pricingTier === "intro")).toBe(true);
  });

  it("counts unparsable lines reported by the reader", async () => {
    const outcome = new RunOutcomeAccumulator();
    const deps = depsFor(
      { "/t/a.jsonl": [turnA] },
      {
        readLines: async (_path, _from, onLine) => {
          onLine(turnA);
          return { offsetReached: 10, linesRead: 3, unparsable: 2 };
        },
      },
    );

    await collectMeasurements(["/t/a.jsonl"], emptyCursor(), "standard", outcome, deps);
    expect(outcome.build("collected", 0, false).skipped).toContainEqual({
      reason: "unparsable-line",
      count: 2,
    });
  });
});
describe("collectMeasurements: with a repository scope", () => {
  const ROOT = "/work/acme/widgets";
  const scope = repositoryScope(ROOT, "/t");
  const OWN = "/t/-work-acme-widgets/s.jsonl";
  const WORKTREE = "/t/-work-acme-widgets--worktrees-task/s.jsonl";
  const SIBLING = "/t/-work-acme-widgets-collector/s.jsonl";

  it("takes every turn of a transcript in the repository's own project directory", async () => {
    // Neither turn's working directory is inside the root: one records a path the repository had
    // before it was moved, the other records none. The directory they are kept in decides.
    const moved = assistantTurn({ messageId: "msg_moved", cwd: "/old/place/widgets" });
    const bare = assistantTurn({ messageId: "msg_bare" });
    const outcome = new RunOutcomeAccumulator();

    const result = await collectMeasurements(
      [OWN],
      emptyCursor(),
      "standard",
      outcome,
      depsFor({ [OWN]: [moved, bare] }),
      scope,
    );

    expect(result.entries.map((entry) => entry.idempotencyKey).sort()).toEqual([
      "msg_bare",
      "msg_moved",
    ]);
    expect(outcome.turnsOutOfScope).toBe(0);
  });

  it("takes from any other transcript only the turns that ran inside the repository", async () => {
    const inWorktree = assistantTurn({ messageId: "msg_in", cwd: `${ROOT}/.worktrees/task` });
    const elsewhere = assistantTurn({ messageId: "msg_out", cwd: "/work/acme/gadgets" });
    const outcome = new RunOutcomeAccumulator();

    const result = await collectMeasurements(
      [WORKTREE],
      emptyCursor(),
      "standard",
      outcome,
      depsFor({ [WORKTREE]: [inWorktree, elsewhere] }),
      scope,
    );

    expect(result.entries.map((entry) => entry.idempotencyKey)).toEqual(["msg_in"]);
    expect(outcome.turnsFound).toBe(1);
    expect(outcome.turnsOutOfScope).toBe(1);
  });

  it("leaves out a sibling repository whose name starts with this one's", async () => {
    const sibling = assistantTurn({ messageId: "msg_sibling", cwd: `${ROOT}-collector` });
    const outcome = new RunOutcomeAccumulator();

    const result = await collectMeasurements(
      [SIBLING],
      emptyCursor(),
      "standard",
      outcome,
      depsFor({ [SIBLING]: [sibling] }),
      scope,
    );

    expect(result.entries).toEqual([]);
    expect(outcome.turnsOutOfScope).toBe(1);
  });

  it("records how far it read a transcript it kept nothing from, so it is not read again", async () => {
    const elsewhere = assistantTurn({ messageId: "msg_out", cwd: "/work/acme/gadgets" });

    const result = await collectMeasurements(
      [SIBLING],
      emptyCursor(),
      "standard",
      new RunOutcomeAccumulator(),
      depsFor({ [SIBLING]: [elsewhere] }),
      scope,
    );

    expect(result.nextCursor.files[SIBLING]).toEqual({ size: 1, mtimeMs: 1, offset: 1 });
  });

  it("reports every turn when no scope is given", async () => {
    const elsewhere = assistantTurn({ messageId: "msg_out", cwd: "/work/acme/gadgets" });
    const outcome = new RunOutcomeAccumulator();

    const result = await collectMeasurements(
      [SIBLING],
      emptyCursor(),
      "standard",
      outcome,
      depsFor({ [SIBLING]: [elsewhere] }),
    );

    expect(result.entries).toHaveLength(1);
    expect(outcome.turnsOutOfScope).toBe(0);
  });
});

describe("collectMeasurements: attribution", () => {
  const taskOf: Attributor = ({ branch }) =>
    branch !== undefined && /^[A-Z][0-9]{3}-/.test(branch)
      ? [{ type: "task", key: branch.slice(0, 4) }]
      : [];
  const onTask = assistantTurn({ messageId: "msg_task", gitBranch: "K123-add-export" });
  const onMain = assistantTurn({ messageId: "msg_main", gitBranch: "main" });
  const noBranch = assistantTurn({ messageId: "msg_none" });

  it("puts on each measurement what the rules derive from its own turn's branch", async () => {
    const outcome = new RunOutcomeAccumulator();
    const result = await collectMeasurements(
      ["/t/a.jsonl"],
      emptyCursor(),
      "standard",
      outcome,
      depsFor({ "/t/a.jsonl": [onTask, onMain, noBranch] }),
      undefined,
      taskOf,
    );

    const byKey = new Map(result.entries.map((entry) => [entry.idempotencyKey, entry]));
    expect(byKey.get("msg_task")?.dimensions).toEqual([{ type: "task", key: "K123" }]);
    expect("dimensions" in (byKey.get("msg_main") ?? {})).toBe(false);
    expect("dimensions" in (byKey.get("msg_none") ?? {})).toBe(false);
  });

  it("counts the measurements that carry a dimension", async () => {
    const outcome = new RunOutcomeAccumulator();
    await collectMeasurements(
      ["/t/a.jsonl"],
      emptyCursor(),
      "standard",
      outcome,
      depsFor({ "/t/a.jsonl": [onTask, onTask, onMain, noBranch] }),
      undefined,
      taskOf,
    );

    expect(outcome.turnsAttributed).toBe(1);
    expect(outcome.measurements).toBe(3);
  });

  it("counts none, and sends none, when the run was given no rules", async () => {
    const outcome = new RunOutcomeAccumulator();
    const result = await collectMeasurements(
      ["/t/a.jsonl"],
      emptyCursor(),
      "standard",
      outcome,
      depsFor({ "/t/a.jsonl": [onTask, onMain] }),
    );

    expect(outcome.turnsAttributed).toBe(0);
    expect(result.entries.some((entry) => "dimensions" in entry)).toBe(false);
  });

  it("attributes only the turns the scope kept", async () => {
    const outcome = new RunOutcomeAccumulator();
    const result = await collectMeasurements(
      ["/t/elsewhere/a.jsonl"],
      emptyCursor(),
      "standard",
      outcome,
      depsFor({
        "/t/elsewhere/a.jsonl": [
          assistantTurn({ messageId: "msg_in", gitBranch: "K123-a", cwd: "/work/acme/widgets" }),
          assistantTurn({ messageId: "msg_out", gitBranch: "K124-b", cwd: "/work/acme/gadgets" }),
        ],
      }),
      repositoryScope("/work/acme/widgets", "/t"),
      taskOf,
    );

    expect(result.entries.map((entry) => entry.idempotencyKey)).toEqual(["msg_in"]);
    expect(outcome.turnsAttributed).toBe(1);
    expect(JSON.stringify(result.entries)).not.toContain("K124");
  });
});
