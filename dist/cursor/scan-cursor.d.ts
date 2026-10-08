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
export declare const CURSOR_VERSION = 1;
export declare function emptyCursor(): ScanCursor;
/**
 * Reads the cursor. A file that is missing, unparsable, or of a version this build does not know
 * is treated as empty — never as an error. A corrupt cursor must not be able to stop a developer's
 * metrics from ever being collected again; the worst it can cost is one full rescan.
 */
export declare function readCursor(path: string): Promise<ScanCursor>;
/**
 * Writes the cursor, keeping only entries for paths still present, so it cannot grow forever as a
 * developer's transcripts rotate away. Written-then-renamed like a queue file, for the same
 * reason: a half-written cursor read by a concurrent run would be treated as empty and cost a
 * needless full rescan.
 *
 * Returns whether it could be written. A cursor that cannot be written is a slower next run, not
 * a failed one, so the caller records it and carries on.
 */
export declare function writeCursor(path: string, cursor: ScanCursor, presentPaths: ReadonlySet<string>): Promise<boolean>;
/**
 * Whether a file has to be read at all, and from where.
 *
 * A file whose recorded size and modification time both still match is skipped entirely. A file
 * that has grown is read from where the last run stopped. Anything else — a file that shrank, was
 * rewritten, or has an offset beyond its current size — is read from zero, which is what makes
 * truncation and rotation work without a special case of their own.
 */
export declare function resumeOffset(entry: CursorEntry | undefined, size: number, mtimeMs: number): "skip" | number;
