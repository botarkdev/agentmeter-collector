import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * Finds the repository a run belongs to, starting from the directory it was started in
 * (specs/repository-scope/decision.md).
 *
 * A `SessionEnd` hook runs in the directory the session was opened in, which is the repository's
 * root, a subdirectory of it, or one of its worktrees. All three must name the same repository, or
 * a session opened in a worktree would report into a scope of its own and find nothing there. So
 * this walks up to the nearest `.git`:
 *
 * - a **directory** is a main working tree, and the directory holding it is the root;
 * - a **file** is a linked worktree or a submodule. A linked worktree's file reads
 *   `gitdir: <main>/.git/worktrees/<name>`, which names the main working tree, and that is the
 *   root. Anything else (a submodule, a layout this does not recognise) is its own root.
 *
 * It reads `.git` and nothing else, spawns no process — `git` may not be installed where the hook
 * runs, and a spawned process is a way to block a session close — and **never throws**: with no
 * `.git` above it, or with one it cannot read, the starting directory is the root.
 */

export interface RepositoryRootDependencies {
  /** `"directory"`, `"file"`, or `undefined` when the path is absent or cannot be inspected. */
  readonly kindOf: (path: string) => Promise<"directory" | "file" | undefined>;
  readonly readText: (path: string) => Promise<string>;
}

export const defaultRepositoryRootDependencies: RepositoryRootDependencies = {
  kindOf: async (path) => {
    try {
      const stats = await stat(path);
      if (stats.isDirectory()) {
        return "directory";
      }
      return stats.isFile() ? "file" : undefined;
    } catch {
      return undefined;
    }
  },
  readText: (path) => readFile(path, "utf8"),
};

const GITDIR_LINE = /^gitdir:\s*(.+?)\s*$/m;
/** `<main working tree>/.git/worktrees/<name>`, with either separator. */
const LINKED_WORKTREE_GITDIR = /^(.+)[\\/]\.git[\\/]worktrees[\\/][^\\/]+[\\/]?$/;

async function rootNamedByGitFile(
  directory: string,
  gitFile: string,
  deps: RepositoryRootDependencies,
): Promise<string> {
  let text: string;
  try {
    text = await deps.readText(gitFile);
  } catch {
    return directory;
  }
  const gitdir = GITDIR_LINE.exec(text)?.[1];
  if (gitdir === undefined) {
    return directory;
  }
  // A relative `gitdir:` is relative to the directory holding the `.git` file.
  const mainWorkingTree = LINKED_WORKTREE_GITDIR.exec(resolve(directory, gitdir))?.[1];
  return mainWorkingTree ?? directory;
}

export async function findRepositoryRoot(
  startDirectory: string,
  deps: RepositoryRootDependencies = defaultRepositoryRootDependencies,
): Promise<string> {
  const start = resolve(startDirectory);
  try {
    let directory = start;
    for (;;) {
      const gitPath = join(directory, ".git");
      const kind = await deps.kindOf(gitPath);
      if (kind === "directory") {
        return directory;
      }
      if (kind === "file") {
        return await rootNamedByGitFile(directory, gitPath, deps);
      }
      const parent = dirname(directory);
      if (parent === directory) {
        return start;
      }
      directory = parent;
    }
  } catch {
    return start;
  }
}
