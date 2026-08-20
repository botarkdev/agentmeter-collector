import type { IngestBatch } from "../contract/ingest-contract.js";
import { ingestUrl, readAcceptance, readServiceError } from "../contract/ingest-contract.js";
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
  readonly headers: { get(name: string): string | null };
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

export type DeliveryOutcome =
  | {
      readonly kind: "accepted";
      readonly accepted: number;
      readonly deduplicated: number;
      readonly rejected: number;
    }
  | {
      readonly kind: "retain";
      readonly reason: FailureReason;
      readonly detail?: string;
      /** Stop trying the remaining batches this run. True whenever every further attempt would
       * fail identically — an unreachable service, an expired token, a stated wait. Spending the
       * run's budget proving that is exactly the obstruction Principle IV forbids. */
      readonly stopDraining: boolean;
    }
  | { readonly kind: "discard"; readonly reason: FailureReason; readonly detail?: string };

export interface IngestTransport {
  deliver(batch: IngestBatch): Promise<DeliveryOutcome>;
}

export interface TransportOptions {
  readonly endpoint: string;
  readonly token: string;
  readonly requestTimeoutMs: number;
}

export class HttpIngestTransport implements IngestTransport {
  private readonly url: string;

  constructor(
    private readonly options: TransportOptions,
    private readonly fetchImpl: FetchLike,
    private readonly makeTimeoutSignal: (ms: number) => AbortSignal = (ms) =>
      AbortSignal.timeout(ms),
  ) {
    this.url = ingestUrl(options.endpoint);
  }

  async deliver(batch: IngestBatch): Promise<DeliveryOutcome> {
    let response: HttpResponseLike;
    try {
      response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: {
          // The token travels here and nowhere else — never a URL, never the body, never a log
          // line (Constitution, Authentication & Credentials; spec.md FR-011, FR-027).
          authorization: `Bearer ${this.options.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(batch),
        signal: this.makeTimeoutSignal(this.options.requestTimeoutMs),
        // Never follow a redirect. A 3xx is not the documented answer, and following one would
        // send an ingest token to a host the developer did not configure.
        redirect: "manual",
      });
    } catch (error) {
      return {
        kind: "retain",
        reason: isTimeout(error) ? "timeout" : "unreachable",
        stopDraining: true,
      };
    }

    return this.classify(response);
  }

  private async classify(response: HttpResponseLike): Promise<DeliveryOutcome> {
    const body = await response.json().catch(() => undefined);

    if (response.status === 200) {
      const acceptance = readAcceptance(body);
      if (acceptance === undefined) {
        // A 200 that is not the documented body — a proxy's error page, a login redirect landing
        // page, a future response shape. Not delivery.
        return { kind: "retain", reason: "unrecognised-response", stopDraining: false };
      }
      return {
        kind: "accepted",
        accepted: acceptance.accepted,
        deduplicated: acceptance.deduplicated,
        rejected: acceptance.rejected,
      };
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after") ?? undefined;
      return {
        kind: "retain",
        reason: "rate-limited",
        stopDraining: true,
        // The service's own stated wait, in seconds. A number it supplied — never anything read
        // from this machine.
        ...(retryAfter === undefined ? {} : { detail: retryAfter }),
      };
    }

    const { code, action } = readServiceError(body);

    if (response.status === 401 || action === "REAUTHENTICATE") {
      return { kind: "retain", reason: "reauthentication-required", stopDraining: true };
    }

    if (action === "DO_NOT_RETRY" || action === "FIX_AND_RETRY") {
      // The service has declared this batch permanently unacceptable. Retaining it would fill the
      // queue forever and push out work that could still succeed (FR-021, FR-022).
      return discard(code);
    }

    if (action === "RETRY" || response.status >= 500) {
      return code === undefined
        ? { kind: "retain", reason: "server-error", stopDraining: false }
        : { kind: "retain", reason: "server-error", stopDraining: false, detail: code };
    }

    if (response.status >= 400) {
      // A 4xx with no action this collector recognises. Resending identical bytes cannot change a
      // client-side refusal, so retaining it would clog the queue on something that can never
      // succeed. Discarded, and reported.
      return discard(code);
    }

    // 1xx/2xx-other/3xx: not the documented answer, and a redirect was not followed.
    return { kind: "retain", reason: "unrecognised-response", stopDraining: false };
  }
}

function discard(code: string | undefined): DeliveryOutcome {
  return code === undefined
    ? { kind: "discard", reason: "rejected-permanently" }
    : { kind: "discard", reason: "rejected-permanently", detail: code };
}

function isTimeout(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}
