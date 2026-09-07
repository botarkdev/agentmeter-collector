import { describe, expect, it, vi } from "vitest";
import { INGEST_PATH, type IngestBatch } from "../../../src/contract/ingest-contract.js";
import {
  HttpIngestTransport,
  type FetchLike,
  type HttpRequestInit,
  type HttpResponseLike,
} from "../../../src/transport/ingest-transport.js";

// A reserved TLD (RFC 2606): it can never resolve, and it is a placeholder rather than a real
// host (Constitution, "Environment-specific values are never committed").
const ENDPOINT = "https://collector.invalid";
const TOKEN = "amk_live_placeholder_token";

const batch: IngestBatch = {
  agent: "claude-code",
  measurements: [
    {
      idempotencyKey: "msg_a",
      occurredAt: "2026-08-20T10:00:00.000Z",
      model: "claude-opus-5",
      pricingTier: "standard",
      tokens: { input: 1, output: 1, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 },
    },
  ],
};

function respond(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): HttpResponseLike {
  return {
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

function transportWith(fetchImpl: FetchLike): HttpIngestTransport {
  return new HttpIngestTransport(
    { endpoint: ENDPOINT, token: TOKEN, requestTimeoutMs: 2000 },
    fetchImpl,
    // A stand-in signal: the real one would make this suite depend on wall-clock timing.
    () => new AbortController().signal,
  );
}

const ACCEPTED = { accepted: 1, deduplicated: 0, rejected: 0, cost: { pricedUsd: "0.000001" } };

describe("HttpIngestTransport: the request it makes", () => {
  it("posts the batch to the versioned ingest path", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => respond(200, ACCEPTED));
    await transportWith(fetchImpl).deliver(batch);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${ENDPOINT}${INGEST_PATH}`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(batch);
  });

  it("carries the token in the Authorization header and nowhere else", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => respond(200, ACCEPTED));
    await transportWith(fetchImpl).deliver(batch);

    const [url, init] = fetchImpl.mock.calls[0]! as [string, HttpRequestInit];
    expect(init.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(url).not.toContain(TOKEN);
    expect(init.body).not.toContain(TOKEN);
  });

  it("refuses to follow a redirect, so a token cannot be sent to an unconfigured host", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => respond(200, ACCEPTED));
    await transportWith(fetchImpl).deliver(batch);
    expect(fetchImpl.mock.calls[0]![1].redirect).toBe("manual");
  });
});

describe("HttpIngestTransport: how it reads the answer", () => {
  it("counts a documented 200 as delivery", async () => {
    const outcome = await transportWith(async () =>
      respond(200, { accepted: 3, deduplicated: 2, rejected: 1 }),
    ).deliver(batch);

    expect(outcome).toEqual({ kind: "accepted", accepted: 3, deduplicated: 2, rejected: 1 });
  });

  it("treats a fully deduplicated batch as delivery — that is what a replay looks like", async () => {
    const outcome = await transportWith(async () =>
      respond(200, { accepted: 0, deduplicated: 5, rejected: 0 }),
    ).deliver(batch);

    expect(outcome.kind).toBe("accepted");
  });

  it("does NOT treat a 200 carrying something else as delivery", async () => {
    // The case this exists for: a proxy answering 200 with an HTML error page. Reading it as
    // success would silently drop the batch.
    const outcome = await transportWith(async () => respond(200, "<html>gateway</html>")).deliver(
      batch,
    );
    expect(outcome).toEqual({
      kind: "retain",
      reason: "unrecognised-response",
      stopDraining: false,
    });
  });

  it("does not treat a 200 whose body is unparsable as delivery", async () => {
    const outcome = await transportWith(async () => ({
      status: 200,
      headers: { get: () => null },
      json: async () => {
        throw new Error("not json");
      },
    })).deliver(batch);
    expect(outcome.kind).toBe("retain");
  });

  it("retains and stops on 429, carrying the wait the service stated", async () => {
    const outcome = await transportWith(async () =>
      respond(429, { code: "TOKEN_RATE_LIMIT_EXCEEDED", action: "RETRY" }, { "retry-after": "42" }),
    ).deliver(batch);

    expect(outcome).toEqual({
      kind: "retain",
      reason: "rate-limited",
      stopDraining: true,
      detail: "42",
    });
  });

  it("retains and stops on 429 even without a Retry-After header", async () => {
    const outcome = await transportWith(async () => respond(429, {})).deliver(batch);
    expect(outcome).toEqual({ kind: "retain", reason: "rate-limited", stopDraining: true });
  });

  it("retains and stops on 401 — the same token would fail on every remaining batch", async () => {
    const outcome = await transportWith(async () =>
      respond(401, { code: "INVALID_INGEST_TOKEN", action: "REAUTHENTICATE" }),
    ).deliver(batch);

    expect(outcome).toEqual({
      kind: "retain",
      reason: "reauthentication-required",
      stopDraining: true,
    });
  });

  it("retains and stops when the service asks for reauthentication under any status", async () => {
    const outcome = await transportWith(async () =>
      respond(403, { code: "X", action: "REAUTHENTICATE" }),
    ).deliver(batch);
    expect(outcome.kind === "retain" && outcome.stopDraining).toBe(true);
  });

  it.each([["DO_NOT_RETRY"], ["FIX_AND_RETRY"]])(
    "discards a batch the service declares permanently unacceptable (%s)",
    async (action) => {
      const outcome = await transportWith(async () =>
        respond(400, { code: "VALIDATION_FAILED", action }),
      ).deliver(batch);

      expect(outcome).toEqual({
        kind: "discard",
        reason: "rejected-permanently",
        detail: "VALIDATION_FAILED",
      });
    },
  );

  it("discards a 4xx whose body names no action — resending identical bytes cannot fix it", async () => {
    const outcome = await transportWith(async () => respond(404, "not found")).deliver(batch);
    expect(outcome).toEqual({ kind: "discard", reason: "rejected-permanently" });
  });

  it("retains and continues on a 5xx", async () => {
    const outcome = await transportWith(async () =>
      respond(503, { code: "X", action: "RETRY" }),
    ).deliver(batch);
    expect(outcome).toEqual({
      kind: "retain",
      reason: "server-error",
      stopDraining: false,
      detail: "X",
    });
  });

  it("retains a 3xx rather than treating an unfollowed redirect as delivery", async () => {
    const outcome = await transportWith(async () => respond(302, "")).deliver(batch);
    expect(outcome).toEqual({
      kind: "retain",
      reason: "unrecognised-response",
      stopDraining: false,
    });
  });

  it("retains and stops when the connection is refused", async () => {
    const outcome = await transportWith(async () => {
      throw Object.assign(new Error("connect ECONNREFUSED"), { name: "TypeError" });
    }).deliver(batch);

    expect(outcome).toEqual({ kind: "retain", reason: "unreachable", stopDraining: true });
  });

  it.each([["TimeoutError"], ["AbortError"]])(
    "retains and stops when the request is aborted (%s)",
    async (name) => {
      const outcome = await transportWith(async () => {
        throw Object.assign(new Error("aborted"), { name });
      }).deliver(batch);

      expect(outcome).toEqual({ kind: "retain", reason: "timeout", stopDraining: true });
    },
  );

  it("never rejects, whatever the transport does", async () => {
    const outcome = await transportWith(async () => {
      // eslint-disable-next-line no-throw-literal
      throw "a string, not an Error";
    }).deliver(batch);
    expect(outcome.kind).toBe("retain");
  });
});
