import { readdir } from "node:fs/promises";
import { join } from "node:path";
const TRANSCRIPT_SUFFIX = ".jsonl";
export async function listTranscriptFiles(root) {
    const files = [];
    let unreadableDirectories = 0;
    const walk = async (directory) => {
        let entries;
        try {
            entries = await readdir(directory, { withFileTypes: true });
        }
        catch (error) {
            // A directory that is not there is not a failure: a machine that has never run Claude Code
            // has no transcripts root at all, and a session directory can be removed while a walk is in
            // progress. Only a directory that exists and cannot be read is worth reporting.
            if (error?.code !== "ENOENT") {
                unreadableDirectories += 1;
            }
            return;
        }
        for (const entry of entries) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) {
                await walk(path);
            }
            else if (entry.isFile() && entry.name.endsWith(TRANSCRIPT_SUFFIX)) {
                files.push(path);
            }
        }
    };
    await walk(root);
    files.sort();
    return { files, unreadableDirectories };
}
