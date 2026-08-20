import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  emptyCursor,
  readCursor,
  resumeOffset,
  writeCursor,
} from "../../../src/cursor/scan-cursor.js";
import { makeTempDir } from "../support/transcripts.js";

describe("readCursor", () => {
  it("round-trips what was written", async () => {
    const directory = await makeTempDir();
    const path = join(directory, "scan-cursor.json");
    const cursor = {
      version: 1 as const,
      files: { "/t/a.jsonl": { size: 10, mtimeMs: 5, offset: 10 } },
    };

    expect(await writeCursor(path, cursor, new Set(["/t/a.jsonl"]))).toBe(true);
    expect(await readCursor(path)).toEqual(cursor);
  });

  it.each([
    ["a file that does not exist", undefined],
    ["contents that are not JSON", "{ broken"],
    ["JSON that is not an object", '"a string"'],
    ["a cursor of an unknown version", '{"version":99,"files":{}}'],
    ["a cursor with no files map", '{"version":1}'],
  ])("treats %s as empty rather than as an error", async (_label, contents) => {
    const directory = await makeTempDir();
    const path = join(directory, "scan-cursor.json");
    if (contents !== undefined) {
      await writeFile(path, contents, "utf8");
    }
    expect(await readCursor(path)).toEqual(emptyCursor());
  });

  it("drops individual entries that are malformed, keeping the rest", async () => {
    const directory = await makeTempDir();
    const path = join(directory, "scan-cursor.json");
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        files: {
          "/t/good.jsonl": { size: 1, mtimeMs: 2, offset: 3 },
          "/t/bad-shape.jsonl": "not an object",
          "/t/bad-numbers.jsonl": { size: -1, mtimeMs: 2, offset: 3 },
          "/t/missing.jsonl": { size: 1 },
        },
      }),
      "utf8",
    );

    const cursor = await readCursor(path);
    expect(Object.keys(cursor.files)).toEqual(["/t/good.jsonl"]);
  });
});

describe("writeCursor", () => {
  it("forgets files that are no longer present, so it cannot grow forever", async () => {
    const directory = await makeTempDir();
    const path = join(directory, "scan-cursor.json");
    const cursor = {
      version: 1 as const,
      files: {
        "/t/still-here.jsonl": { size: 1, mtimeMs: 1, offset: 1 },
        "/t/rotated-away.jsonl": { size: 2, mtimeMs: 2, offset: 2 },
      },
    };

    await writeCursor(path, cursor, new Set(["/t/still-here.jsonl"]));
    expect(Object.keys((await readCursor(path)).files)).toEqual(["/t/still-here.jsonl"]);
  });

  it("creates the cache directory if it is not there yet", async () => {
    const directory = await makeTempDir();
    const path = join(directory, "nested", "deeper", "scan-cursor.json");
    expect(await writeCursor(path, emptyCursor(), new Set())).toBe(true);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ version: 1, files: {} });
  });

  it("reports failure rather than throwing when it cannot write", async () => {
    const directory = await makeTempDir();
    // A regular file where a directory needs to be.
    await writeFile(join(directory, "blocked"), "in the way", "utf8");
    const path = join(directory, "blocked", "scan-cursor.json");
    expect(await writeCursor(path, emptyCursor(), new Set())).toBe(false);
  });
});

describe("resumeOffset", () => {
  it("reads from the start when there is no record of the file", () => {
    expect(resumeOffset(undefined, 100, 1)).toBe(0);
  });

  it("skips a file whose size and modification time are both unchanged", () => {
    expect(resumeOffset({ size: 100, mtimeMs: 5, offset: 100 }, 100, 5)).toBe("skip");
  });

  it("resumes where it stopped when the file has grown", () => {
    expect(resumeOffset({ size: 100, mtimeMs: 5, offset: 90 }, 250, 9)).toBe(90);
  });

  it("re-reads from the start when the file shrank — truncation and rotation need no special case", () => {
    expect(resumeOffset({ size: 100, mtimeMs: 5, offset: 100 }, 40, 9)).toBe(0);
  });

  it("re-reads from the start when the recorded offset is beyond the file", () => {
    expect(resumeOffset({ size: 100, mtimeMs: 5, offset: 500 }, 400, 9)).toBe(0);
  });

  it("re-reads from the start a file rewritten to the same size at a different time", () => {
    // Same size and a new mtime means rewritten in place, not appended to: resuming at the old
    // offset would silently miss everything that changed.
    expect(resumeOffset({ size: 100, mtimeMs: 5, offset: 100 }, 100, 77)).toBe(0);
  });
});
