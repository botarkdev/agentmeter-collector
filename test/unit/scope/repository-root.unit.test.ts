import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findRepositoryRoot } from "../../../src/scope/repository-root.js";
import { makeTempDir } from "../support/transcripts.js";

/**
 * Against a real temporary directory: what this module gets right or wrong is how it reads a
 * `.git` that is a directory, a file, or missing, and a mocked `fs` would only assert the mock.
 * No `git` is run — the layouts are written by hand, exactly as git writes them.
 */
async function mainWorkingTree(): Promise<string> {
  const root = join(await makeTempDir(), "repository");
  await mkdir(join(root, ".git"), { recursive: true });
  return root;
}

describe("findRepositoryRoot", () => {
  it("is the directory holding a .git directory", async () => {
    const root = await mainWorkingTree();
    expect(await findRepositoryRoot(root)).toBe(root);
  });

  it("is found from a subdirectory of the repository", async () => {
    const root = await mainWorkingTree();
    const nested = join(root, "apps", "api", "src");
    await mkdir(nested, { recursive: true });

    expect(await findRepositoryRoot(nested)).toBe(root);
  });

  it("is the main working tree when started in a linked worktree", async () => {
    const root = await mainWorkingTree();
    const worktree = join(root, ".worktrees", "some-task");
    await mkdir(worktree, { recursive: true });
    await writeFile(
      join(worktree, ".git"),
      `gitdir: ${join(root, ".git", "worktrees", "some-task")}\n`,
      "utf8",
    );

    expect(await findRepositoryRoot(worktree)).toBe(root);
  });

  it("is the main working tree for a linked worktree that lives outside it", async () => {
    const root = await mainWorkingTree();
    const worktree = join(await makeTempDir(), "elsewhere");
    await mkdir(join(worktree, "src"), { recursive: true });
    await writeFile(
      join(worktree, ".git"),
      `gitdir: ${join(root, ".git", "worktrees", "elsewhere")}\n`,
      "utf8",
    );

    expect(await findRepositoryRoot(join(worktree, "src"))).toBe(root);
  });

  it("resolves a relative gitdir against the directory holding the .git file", async () => {
    const root = await mainWorkingTree();
    const worktree = join(root, ".worktrees", "relative");
    await mkdir(worktree, { recursive: true });
    await writeFile(join(worktree, ".git"), "gitdir: ../../.git/worktrees/relative\n", "utf8");

    expect(await findRepositoryRoot(worktree)).toBe(root);
  });

  it("treats a .git file that names no worktree — a submodule — as its own root", async () => {
    const root = await mainWorkingTree();
    const submodule = join(root, "vendor", "library");
    await mkdir(submodule, { recursive: true });
    await writeFile(join(submodule, ".git"), "gitdir: ../../.git/modules/library\n", "utf8");

    expect(await findRepositoryRoot(submodule)).toBe(submodule);
  });

  it("treats a .git file it cannot make sense of as its own root", async () => {
    const directory = join(await makeTempDir(), "odd");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, ".git"), "not a gitdir line\n", "utf8");

    expect(await findRepositoryRoot(directory)).toBe(directory);
  });

  it("is the starting directory when a .git file cannot be read", async () => {
    const start = "/placeholder/worktree";
    const root = await findRepositoryRoot(start, {
      kindOf: async (path) => (path === join(start, ".git") ? "file" : undefined),
      readText: async () => {
        throw new Error("permission denied");
      },
    });

    expect(root).toBe(start);
  });

  it("is the starting directory when nothing above it is a repository", async () => {
    const start = "/placeholder/not/a/repository";
    const root = await findRepositoryRoot(start, {
      kindOf: async () => undefined,
      readText: async () => "",
    });

    expect(root).toBe(start);
  });

  it("does not raise when the filesystem does, and falls back to the starting directory", async () => {
    const start = "/placeholder/broken";
    const root = await findRepositoryRoot(start, {
      kindOf: async () => {
        throw new Error("the filesystem is having a day");
      },
      readText: async () => "",
    });

    expect(root).toBe(start);
  });
});
