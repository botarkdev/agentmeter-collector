/**
 * Finds Claude Code's session transcripts.
 *
 * Claude Code writes one directory per project path under its transcripts root, plus a directory
 * per git worktree, and one JSONL per session inside. This walks the whole tree and lists every
 * transcript on the machine, and reads no directory name for meaning. Which of them a run
 * reports is decided afterwards, by the run's scope (`src/scope/turn-scope.ts`): the listing has
 * to be complete, because a session opened in a worktree is kept under another directory and
 * only its turns say which repository it belongs to.
 *
 * Never throws. A missing root yields nothing (a machine with no Claude Code history is a
 * successful, empty run), and an unreadable subdirectory is skipped and counted.
 */
export interface TranscriptDiscovery {
    /** Absolute paths, sorted, so a run is deterministic and reproducible. */
    readonly files: readonly string[];
    readonly unreadableDirectories: number;
}
export declare function listTranscriptFiles(root: string): Promise<TranscriptDiscovery>;
