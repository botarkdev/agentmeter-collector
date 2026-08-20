import { readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Finds Claude Code's session transcripts.
 *
 * Claude Code writes one directory per project path under its transcripts root, plus a directory
 * per git worktree, and one JSONL per session inside. This walks the whole tree rather than
 * matching a configured list of project paths the way the reference implementation does: a
 * configured list is attribution — deciding which repository a session belongs to — and
 * attribution is TODO.md row T013. Here, every transcript on the machine belongs to the one
 * project the configured ingest token names, and nothing reads a directory name for meaning.
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
