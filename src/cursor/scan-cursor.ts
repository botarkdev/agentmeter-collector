import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Remembers how far each transcript has been read, so a session close does not rescan every
 * transcript a developer has ever produced.
 *
 * **This is an optimisation and correctness never touches it** (Constitution, Principle III:
 * local state is permitted only as a performance optimisation). Deleting this file makes the next
 * run re-read everything and resubmit it; the service's ledger deduplicates the result, so the
 * only observable difference is how long the run takes. Nothing in this package branches on the
 * cursor to decide WHAT a measurement is — only on how much has to be read to find it.
 *
 * The one structure in this package that contains file paths. It is never transmitted, never
 * included in a run outcome, and never written into a queue file: it stays in the developer's own
 * cache directory, beside the transcripts whose paths it names.
 */

export interface CursorEntry {
  readonly size: number;
  readonly mtimeMs: number;
  readonly offset: number;
}

export interface ScanCursor {
  readonly version: 1;
  readonly files: Readonly<Record<string, CursorEntry>>;
}

export const CURSOR_VERSION = 1;

export function emptyCursor(): ScanCursor {
  return { version: CURSOR_VERSION, files: {} };
}

/**
 * Reads the cursor. A file that is missing, unparsable, or of a version this build does not know
 * is treated as empty — never as an error. A corrupt cursor must not be able to stop a developer's
 * metrics from ever being collected again; the worst it can cost is one full rescan.
 */
export async function readCursor(path: string): Promise<ScanCursor> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return emptyCursor();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyCursor();
  }
  if (typeof parsed !== "object" || parsed === null) {
    return emptyCursor();
  }
  const record = parsed as Record<string, unknown>;
  if (
    record.version !== CURSOR_VERSION ||
    typeof record.files !== "object" ||
    record.files === null
  ) {
    return emptyCursor();
  }

  const files: Record<string, CursorEntry> = {};
  for (const [path_, value] of Object.entries(record.files as Record<string, unknown>)) {
    const entry = readEntry(value);
    if (entry !== undefined) {
      files[path_] = entry;
    }
  }
  return { version: CURSOR_VERSION, files };
}

function readEntry(value: unknown): CursorEntry | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const { size, mtimeMs, offset } = record;
  if (
    typeof size !== "number" ||
    typeof mtimeMs !== "number" ||
    typeof offset !== "number" ||
    size < 0 ||
    offset < 0
  ) {
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
export async function writeCursor(
  path: string,
  cursor: ScanCursor,
  presentPaths: ReadonlySet<string>,
): Promise<boolean> {
  const files: Record<string, CursorEntry> = {};
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
  } catch {
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
export function resumeOffset(
  entry: CursorEntry | undefined,
  size: number,
  mtimeMs: number,
): "skip" | number {
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
