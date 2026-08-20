import { readFile, stat, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readTranscriptLines } from "../../../src/claude-code/transcript-reader.js";
import { makeTempDir, writeTranscript } from "../support/transcripts.js";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const directory = await makeTempDir();
  dirs.push(directory);
  return directory;
}

afterEach(() => {
  dirs.length = 0;
});

async function collect(path: string, from = 0) {
  const parsed: unknown[] = [];
  const result = await readTranscriptLines(path, from, (value) => parsed.push(value));
  return { parsed, result };
}

describe("readTranscriptLines", () => {
  it("parses every complete line and reports the offset after the last one", async () => {
    const directory = await tempDir();
    const path = await writeTranscript(directory, "s.jsonl", [{ a: 1 }, { a: 2 }, { a: 3 }]);
    const { parsed, result } = await collect(path);

    expect(parsed).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
    expect(result.linesRead).toBe(3);
    expect(result.unparsable).toBe(0);
    expect(result.offsetReached).toBe((await stat(path)).size);
  });

  it("stops before a truncated tail, so the next run reads that line whole", async () => {
    const directory = await tempDir();
    const path = join(directory, "s.jsonl");
    const complete = `${JSON.stringify({ a: 1 })}\n`;
    await writeFile(path, `${complete}{"a":2`, "utf8");

    const { parsed, result } = await collect(path);
    expect(parsed).toEqual([{ a: 1 }]);
    expect(result.offsetReached).toBe(Buffer.byteLength(complete));

    // The line is completed later, exactly as a live session would complete it.
    await writeFile(path, `${complete}${JSON.stringify({ a: 2 })}\n`, "utf8");
    const second = await collect(path, result.offsetReached);
    expect(second.parsed).toEqual([{ a: 2 }]);
  });

  it("resumes from an offset without re-reading what came before", async () => {
    const directory = await tempDir();
    const path = await writeTranscript(directory, "s.jsonl", [{ a: 1 }, { a: 2 }]);
    const first = await collect(path);
    expect(first.parsed).toHaveLength(2);

    const again = await collect(path, first.result.offsetReached);
    expect(again.parsed).toEqual([]);
    expect(again.result.offsetReached).toBe(first.result.offsetReached);
  });

  it("counts a malformed line as unparsable and keeps reading the rest", async () => {
    const directory = await tempDir();
    const path = await writeTranscript(directory, "s.jsonl", [
      { a: 1 },
      "{ not json at all",
      { a: 3 },
    ]);
    const { parsed, result } = await collect(path);
    expect(parsed).toEqual([{ a: 1 }, { a: 3 }]);
    expect(result.unparsable).toBe(1);
  });

  it("tracks offsets in BYTES, so a multi-byte character does not desynchronise the resume", async () => {
    const directory = await tempDir();
    // Characters outside the BMP: the character count and the byte count differ substantially.
    const path = await writeTranscript(directory, "s.jsonl", [
      { text: "𝔘𝔫𝔦𝔠𝔬𝔡𝔢 —— ✅✅✅" },
      { a: 2 },
    ]);
    const { result } = await collect(path);
    expect(result.offsetReached).toBe((await stat(path)).size);

    const rest = await collect(path, result.offsetReached);
    expect(rest.parsed).toEqual([]);
  });

  it("skips a single oversized line without stranding the lines after it", async () => {
    const directory = await tempDir();
    const path = join(directory, "s.jsonl");
    const huge = `{"big":"${"x".repeat(2_000_000)}"}`;
    await writeFile(path, `${huge}\n${JSON.stringify({ a: 2 })}\n`, "utf8");

    const { parsed, result } = await collect(path);
    // The point: the line AFTER the monster is still collected.
    expect(parsed).toEqual([{ a: 2 }]);
    expect(result.unparsable).toBe(1);
    expect(result.offsetReached).toBe((await stat(path)).size);
  });

  it("handles an empty file", async () => {
    const directory = await tempDir();
    const path = await writeTranscript(directory, "s.jsonl", []);
    const { parsed, result } = await collect(path);
    expect(parsed).toEqual([]);
    expect(result).toEqual({ offsetReached: 0, linesRead: 0, unparsable: 0 });
  });

  it("ignores blank lines rather than counting them as malformed", async () => {
    const directory = await tempDir();
    const path = join(directory, "s.jsonl");
    await writeFile(path, `${JSON.stringify({ a: 1 })}\n\n${JSON.stringify({ a: 2 })}\n`, "utf8");
    const { parsed, result } = await collect(path);
    expect(parsed).toEqual([{ a: 1 }, { a: 2 }]);
    expect(result.unparsable).toBe(0);
  });

  it("never modifies the transcript it reads (FR-002)", async () => {
    const directory = await tempDir();
    const path = await writeTranscript(directory, "s.jsonl", [{ a: 1 }, { a: 2 }]);
    const before = await readFile(path, "utf8");
    const beforeStat = await stat(path);

    await collect(path);

    expect(await readFile(path, "utf8")).toBe(before);
    expect((await stat(path)).mtimeMs).toBe(beforeStat.mtimeMs);
    expect((await stat(path)).size).toBe(beforeStat.size);
  });

  it("rejects when the file cannot be read, so the caller can record it and carry on", async () => {
    const directory = await tempDir();
    const path = await writeTranscript(directory, "s.jsonl", [{ a: 1 }]);
    await chmod(path, 0o000);

    // Running as root defeats permission bits entirely; in that case this assertion cannot be
    // made, and the caller's own handling is covered by collect.unit.test.ts's injected failure.
    if (process.getuid?.() === 0) {
      await chmod(path, 0o600);
      return;
    }
    await expect(collect(path)).rejects.toThrow();
    await chmod(path, 0o600);
  });
});
