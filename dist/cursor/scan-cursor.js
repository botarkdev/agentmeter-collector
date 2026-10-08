import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
export const CURSOR_VERSION = 1;
export function emptyCursor() {
    return { version: CURSOR_VERSION, files: {} };
}
/**
 * Reads the cursor. A file that is missing, unparsable, or of a version this build does not know
 * is treated as empty — never as an error. A corrupt cursor must not be able to stop a developer's
 * metrics from ever being collected again; the worst it can cost is one full rescan.
 */
export async function readCursor(path) {
    let raw;
    try {
        raw = await readFile(path, "utf8");
    }
    catch {
        return emptyCursor();
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return emptyCursor();
    }
    if (typeof parsed !== "object" || parsed === null) {
        return emptyCursor();
    }
    const record = parsed;
    if (record.version !== CURSOR_VERSION ||
        typeof record.files !== "object" ||
        record.files === null) {
        return emptyCursor();
    }
    const files = {};
    for (const [path_, value] of Object.entries(record.files)) {
        const entry = readEntry(value);
        if (entry !== undefined) {
            files[path_] = entry;
        }
    }
    return { version: CURSOR_VERSION, files };
}
function readEntry(value) {
    if (typeof value !== "object" || value === null) {
        return undefined;
    }
    const record = value;
    const { size, mtimeMs, offset } = record;
    if (typeof size !== "number" ||
        typeof mtimeMs !== "number" ||
        typeof offset !== "number" ||
        size < 0 ||
        offset < 0) {
        return undefined;
    }
    return { size, mtimeMs, offset };
}
/**
 * Writes the cursor, keeping only entries for paths still present, so it cannot grow forever as a
 * developer's transcripts rotate away. Written-then-renamed like a queue file, for the same
 * reason: a half-written cursor read by a concurrent run would be treated as empty and cost a
 * needless full rescan.
 *
 * Returns whether it could be written. A cursor that cannot be written is a slower next run, not
 * a failed one, so the caller records it and carries on.
 */
export async function writeCursor(path, cursor, presentPaths) {
    const files = {};
    for (const [filePath, entry] of Object.entries(cursor.files)) {
        if (presentPaths.has(filePath)) {
            files[filePath] = entry;
        }
    }
    const temporaryPath = `${path}.tmp`;
    try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(temporaryPath, JSON.stringify({ version: CURSOR_VERSION, files }), "utf8");
        await rename(temporaryPath, path);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Whether a file has to be read at all, and from where.
 *
 * A file whose recorded size and modification time both still match is skipped entirely. A file
 * that has grown is read from where the last run stopped. Anything else — a file that shrank, was
 * rewritten, or has an offset beyond its current size — is read from zero, which is what makes
 * truncation and rotation work without a special case of their own.
 */
export function resumeOffset(entry, size, mtimeMs) {
    if (entry === undefined) {
        return 0;
    }
    if (entry.size === size && entry.mtimeMs === mtimeMs) {
        return "skip";
    }
    // Same size, different time: rewritten in place rather than appended to, so what was read
    // before is not what is there now. Re-reading costs a redundant send the ledger absorbs;
    // resuming would silently miss the new content, which nothing absorbs.
    if (size <= entry.size || entry.offset > size) {
        return 0;
    }
    return entry.offset;
}
