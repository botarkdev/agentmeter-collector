export interface TranscriptReadResult {
    /** Byte offset after the last COMPLETE line consumed. Safe to record; a partial tail is not
     * included. */
    readonly offsetReached: number;
    readonly linesRead: number;
    readonly unparsable: number;
}
export type LineHandler = (parsed: unknown) => void;
export declare function readTranscriptLines(filePath: string, fromOffset: number, onLine: LineHandler): Promise<TranscriptReadResult>;
