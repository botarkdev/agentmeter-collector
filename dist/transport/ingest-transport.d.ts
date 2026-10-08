import type { IngestBatch } from "../contract/ingest-contract.js";
import type { FailureReason } from "../run/run-outcome.js";
/**
 * Delivers one batch and classifies the answer
 * (specs/0019-claude-code-collector/contracts/ingest-submission.md).
 *
 * Two invariants hold across every branch below, and both are what make "never blocks, never
 * fails, never double-counts" true rather than aspirational:
 *
 * - **A batch is discarded only when the service has accounted for it** — accepted, deduplicated,
 *   rejected, or declared permanently invalid. Everything else retains, including anything this
 *   collector cannot positively recognise as the documented success response (FR-020).
 * - **Nothing here throws.** Every failure becomes a classified outcome.
 *
 * `fetch` is injected as a structural type rather than taken from the global, so the whole of this
 * classification is testable against a service that hangs, redirects, or answers with a proxy's
 * HTML error page — none of which can be provoked from a real network in a unit test.
 */
export interface HttpResponseLike {
    readonly status: number;
    readonly headers: {
        get(name: string): string | null;
    };
    json(): Promise<unknown>;
}
export interface HttpRequestInit {
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly signal?: AbortSignal;
    readonly redirect?: "manual";
}
export type FetchLike = (url: string, init: HttpRequestInit) => Promise<HttpResponseLike>;
export type DeliveryOutcome = {
    readonly kind: "accepted";
    readonly accepted: number;
    readonly deduplicated: number;
    readonly rejected: number;
} | {
    readonly kind: "retain";
    readonly reason: FailureReason;
    readonly detail?: string;
    /** Stop trying the remaining batches this run. True whenever every further attempt would
     * fail identically — an unreachable service, an expired token, a stated wait. Spending the
     * run's budget proving that is exactly the obstruction Principle IV forbids. */
    readonly stopDraining: boolean;
} | {
    readonly kind: "discard";
    readonly reason: FailureReason;
    readonly detail?: string;
};
export interface IngestTransport {
    deliver(batch: IngestBatch): Promise<DeliveryOutcome>;
}
export interface TransportOptions {
    readonly endpoint: string;
    readonly token: string;
    readonly requestTimeoutMs: number;
}
export declare class HttpIngestTransport implements IngestTransport {
    private readonly options;
    private readonly fetchImpl;
    private readonly makeTimeoutSignal;
    private readonly url;
    constructor(options: TransportOptions, fetchImpl: FetchLike, makeTimeoutSignal?: (ms: number) => AbortSignal);
    deliver(batch: IngestBatch): Promise<DeliveryOutcome>;
    private classify;
}
