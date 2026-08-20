import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listTranscriptFiles } from "../../../src/claude-code/transcript-locations.js";
import { makeTempDir, writeTranscript } from "../support/transcripts.js";

describe("listTranscriptFiles", () => {
  it("finds transcripts in per-project and per-worktree directories alike", async () => {
    const root = await makeTempDir();
    await writeTranscript(join(root, "-repo-one"), "a.jsonl", [{ a: 1 }]);
    await writeTranscript(join(root, "-repo-one--claude-worktrees-branch"), "b.jsonl", [{ a: 1 }]);
    await writeTranscript(join(root, "-repo-two"), "c.jsonl", [{ a: 1 }]);

    const { files } = await listTranscriptFiles(root);
    expect(files.map((path) => path.slice(root.length + 1))).toEqual([
      "-repo-one--claude-worktrees-branch/b.jsonl",
      "-repo-one/a.jsonl",
      "-repo-two/c.jsonl",
    ]);
  });

  it("returns a sorted list, so a run is reproducible", async () => {
    const root = await makeTempDir();
    await writeTranscript(join(root, "p"), "c.jsonl", [{ a: 1 }]);
    await writeTranscript(join(root, "p"), "a.jsonl", [{ a: 1 }]);
    await writeTranscript(join(root, "p"), "b.jsonl", [{ a: 1 }]);

    const { files } = await listTranscriptFiles(root);
    expect(files).toEqual([...files].sort());
  });

  it("ignores files that are not transcripts", async () => {
    const root = await makeTempDir();
    await mkdir(join(root, "p"), { recursive: true });
    await writeFile(join(root, "p", "notes.txt"), "hello", "utf8");
    await writeFile(join(root, "p", "s.jsonl.tmp"), "{}", "utf8");
    await writeTranscript(join(root, "p"), "s.jsonl", [{ a: 1 }]);

    const { files } = await listTranscriptFiles(root);
    expect(files).toHaveLength(1);
    expect(files[0]?.endsWith("s.jsonl")).toBe(true);
  });

  it("treats a missing root as an empty machine, not as a failure", async () => {
    const root = await makeTempDir();
    const result = await listTranscriptFiles(join(root, "never-created"));
    expect(result).toEqual({ files: [], unreadableDirectories: 0 });
  });

  it("skips and counts a directory it cannot read, and still returns the others", async () => {
    const root = await makeTempDir();
    await writeTranscript(join(root, "readable"), "a.jsonl", [{ a: 1 }]);
    const locked = join(root, "locked");
    await mkdir(locked, { recursive: true });
    await writeTranscript(locked, "b.jsonl", [{ a: 1 }]);
    await chmod(locked, 0o000);

    if (process.getuid?.() === 0) {
      await chmod(locked, 0o700);
      return;
    }

    const result = await listTranscriptFiles(root);
    await chmod(locked, 0o700);

    expect(result.files).toHaveLength(1);
    expect(result.unreadableDirectories).toBe(1);
  });
});
