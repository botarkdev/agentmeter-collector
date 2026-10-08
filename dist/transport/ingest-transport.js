import { ingestUrl, readAcceptance, readServiceError } from "../contract/ingest-contract.js";
export class HttpIngestTransport {
    options;
    fetchImpl;
    makeTimeoutSignal;
    url;
    constructor(options, fetchImpl, makeTimeoutSignal = (ms) => AbortSignal.timeout(ms)) {
        this.options = options;
        this.fetchImpl = fetchImpl;
        this.makeTimeoutSignal = makeTimeoutSignal;
        this.url = ingestUrl(options.endpoint);
    }
    async deliver(batch) {
        let response;
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
        }
        catch (error) {
            return {
                kind: "retain",
                reason: isTimeout(error) ? "timeout" : "unreachable",
                stopDraining: true,
            };
        }
        return this.classify(response);
    }
    async classify(response) {
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
function discard(code) {
    return code === undefined
        ? { kind: "discard", reason: "rejected-permanently" }
        : { kind: "discard", reason: "rejected-permanently", detail: code };
}
function isTimeout(error) {
    const name = error?.name;
    return name === "TimeoutError" || name === "AbortError";
}
