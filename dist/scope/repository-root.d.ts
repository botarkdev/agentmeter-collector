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
export declare const defaultRepositoryRootDependencies: RepositoryRootDependencies;
export declare function findRepositoryRoot(startDirectory: string, deps?: RepositoryRootDependencies): Promise<string>;
