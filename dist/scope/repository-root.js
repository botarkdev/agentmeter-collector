import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
export const defaultRepositoryRootDependencies = {
    kindOf: async (path) => {
        try {
            const stats = await stat(path);
            if (stats.isDirectory()) {
                return "directory";
            }
            return stats.isFile() ? "file" : undefined;
        }
        catch {
            return undefined;
        }
    },
    readText: (path) => readFile(path, "utf8"),
};
const GITDIR_LINE = /^gitdir:\s*(.+?)\s*$/m;
/** `<main working tree>/.git/worktrees/<name>`, with either separator. */
const LINKED_WORKTREE_GITDIR = /^(.+)[\\/]\.git[\\/]worktrees[\\/][^\\/]+[\\/]?$/;
async function rootNamedByGitFile(directory, gitFile, deps) {
    let text;
    try {
        text = await deps.readText(gitFile);
    }
    catch {
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
export async function findRepositoryRoot(startDirectory, deps = defaultRepositoryRootDependencies) {
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
    }
    catch {
        return start;
    }
}
