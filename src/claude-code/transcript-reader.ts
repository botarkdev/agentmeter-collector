import { createReadStream } from "node:fs";

/**
 * Reads a JSONL transcript from a byte offset and hands each parsed line to a callback.
 *
 * Three properties this exists to guarantee, each of which a naive implementation gets wrong:
 *
 * 1. **Whole lines only.** A transcript being written while the hook fires ends in a partial line.
 *    It is not parsed, and the offset returned stops before it, so the next run reads it whole
 *    (spec.md FR-017, US4). Byte offsets, not character counts — a multi-byte character in a
 *    prompt would otherwise desynchronise every subsequent offset.
 * 2. **The file is never modified.** Opened read-only, and nothing writes back (spec.md FR-002).
 * 3. **Bounded memory.** A single pathological line — a megabyte-long tool result — is skipped
 *    without buffering it, and without getting stuck: the scan keeps consuming bytes until the
 *    next newline, so the lines after it are still read. Stopping at it instead would strand
 *    every later line in that file forever.
 */

/** A line longer than this is skipped rather than buffered. Comfortably above any real transcript
 * line and far below anything that would trouble a session close. */
const MAX_LINE_BYTES = 1_048_576;

const NEWLINE = 0x0a;

export interface TranscriptReadResult {
  /** Byte offset after the last COMPLETE line consumed. Safe to record; a partial tail is not
   * included. */
  readonly offsetReached: number;
  readonly linesRead: number;
  readonly unparsable: number;
}

export type LineHandler = (parsed: unknown) => void;

export async function readTranscriptLines(
  filePath: string,
  fromOffset: number,
  onLine: LineHandler,
): Promise<TranscriptReadResult> {
  let offsetReached = Math.max(0, fromOffset);
  let linesRead = 0;
  let unparsable = 0;

  let pending: Buffer = Buffer.alloc(0);
  // True while discarding the remainder of a line that exceeded MAX_LINE_BYTES.
  let discardingOversizedLine = false;

  const handleLine = (line: Buffer): void => {
    linesRead += 1;
    if (line.length === 0) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line.toString("utf8"));
    } catch {
      unparsable += 1;
      return;
    }
    onLine(parsed);
  };

  const stream = createReadStream(filePath, { start: offsetReached });
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);

    for (;;) {
      const index = pending.indexOf(NEWLINE);
      if (index === -1) {
        break;
      }
      const line = pending.subarray(0, index);
      pending = pending.subarray(index + 1);
      offsetReached += index + 1;
      if (discardingOversizedLine) {
        discardingOversizedLine = false;
        unparsable += 1;
        continue;
      }
      handleLine(line);
    }

    if (pending.length > MAX_LINE_BYTES) {
      // Drop what has been buffered and keep consuming until the next newline. The dropped bytes
      // still count towards the offset, so the file advances and the lines after this one are
      // read normally.
      offsetReached += pending.length;
      pending = Buffer.alloc(0);
      discardingOversizedLine = true;
    }
  }

  return { offsetReached, linesRead, unparsable };
}
