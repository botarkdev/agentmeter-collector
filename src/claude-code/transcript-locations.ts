import { readdir } from "node:fs/promises";
import { join } from "node:path";

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

const TRANSCRIPT_SUFFIX = ".jsonl";

export async function listTranscriptFiles(root: string): Promise<TranscriptDiscovery> {
  const files: string[] = [];
  let unreadableDirectories = 0;

  const walk = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      // A directory that is not there is not a failure: a machine that has never run Claude Code
      // has no transcripts root at all, and a session directory can be removed while a walk is in
      // progress. Only a directory that exists and cannot be read is worth reporting.
      if ((error as NodeJS.ErrnoException | null)?.code !== "ENOENT") {
        unreadableDirectories += 1;
      }
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile() && entry.name.endsWith(TRANSCRIPT_SUFFIX)) {
        files.push(path);
      }
    }
  };

  await walk(root);
  files.sort();
  return { files, unreadableDirectories };
}
