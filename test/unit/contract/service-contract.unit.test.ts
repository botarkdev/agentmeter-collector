import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { UsageTurn } from "../../../src/claude-code/usage-extraction.js";
import {
  CLAUDE_CODE_AGENT,
  CLIENT_ACTIONS,
  INGEST_PATH,
  readAcceptance,
  readServiceError,
  splitIntoBatches,
  type IngestBatch,
  type MeasurementEntry,
} from "../../../src/contract/ingest-contract.js";
import {
  MEASUREMENT_ENTRY_FIELDS,
  TOKEN_FIELDS,
  projectMeasurement,
} from "../../../src/contract/measurement-projection.js";
import {
  HttpIngestTransport,
  type DeliveryOutcome,
  type FetchLike,
  type HttpRequestInit,
  type HttpResponseLike,
} from "../../../src/transport/ingest-transport.js";

/**
 * Holds this collector to the document in which the service pins what the collector relies on.
 *
 * The service is the authority on the contract (CLAUDE.md, rule 4). Its repository is private, so
 * the document cannot be read by address, and these tests use no network: what is read here is a
 * byte-for-byte copy, `test/fixtures/collector-ingest.contract.json`, with a record beside it of
 * where it came from, which version it is and what its SHA-256 is. The copy is evidence of what
 * the collector was checked against, never a second definition, and nothing under `src/` reads it.
 *
 * The service's own test checks compatibility: its endpoint may accept more than the document
 * names. This one checks equality in the other direction: **the collector sends nothing the
 * document does not name, and reads nothing out of an answer that the document does not pin.**
 * So a field added to the projection alone fails here. An approved one arrives in two deliberate
 * steps: the service names it in its document and raises `version`, and the copy is refreshed;
 * and the collector adds it to `MEASUREMENT_ENTRY_FIELDS` and to the projection.
 *
 * When a test here fails, the collector has departed from the document, or the copy has been
 * changed. Never edit the copy to make it pass. To refresh it when the service raises `version`:
 * replace the copy with the service's file, byte for byte; update `version`, `sha256`,
 * `copiedOn` and `source.commit` in the record; then make the collector agree with it.
 *
 * Every expected name, path, status and action below is read from the document. What this file
 * holds of its own is how a document entry maps onto a turn (`turnFrom`) and what the collector
 * does with each refusal (`REFUSAL_OUTCOMES`), which the document does not say and
 * specs/0019-claude-code-collector/contracts/ingest-submission.md does.
 */

interface ContractExampleEntry {
  readonly idempotencyKey: string;
  readonly occurredAt: string;
  readonly sessionId?: string;
  readonly model: string;
  readonly pricingTier: string;
  readonly tokens: UsageTurn["tokens"];
}

interface ContractDocument {
  readonly contract: string;
  readonly version: number;
  readonly request: {
    readonly method: string;
    readonly path: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly batchFields: readonly string[];
    readonly measurementFields: {
      readonly always: readonly string[];
      readonly whenKnown: readonly string[];
    };
    readonly tokenFields: readonly string[];
    readonly examples: readonly {
      readonly agent: string;
      readonly measurements: readonly ContractExampleEntry[];
    }[];
  };
  readonly accepted: {
    readonly status: number;
    readonly integerFields: readonly string[];
    readonly example: Readonly<Record<string, unknown>>;
  };
  readonly refused: {
    readonly bodyFields: readonly string[];
    readonly actions: readonly string[];
    readonly cases: Readonly<
      Record<string, { readonly status: number; readonly action: string; readonly header?: string }>
    >;
  };
}

interface ProvenanceRecord {
  readonly document: string;
  readonly source: {
    readonly repository: string;
    readonly path: string;
    readonly addedBy: string;
    readonly commit: string | null;
  };
  readonly version: number;
  readonly sha256: string;
  readonly copiedOn: string;
}

const FIXTURES = new URL("../../fixtures/", import.meta.url);
const provenance = JSON.parse(
  readFileSync(new URL("collector-ingest.contract.provenance.json", FIXTURES), "utf8"),
) as ProvenanceRecord;
const copyBytes = readFileSync(new URL(provenance.document, FIXTURES));
const contract = JSON.parse(copyBytes.toString("utf8")) as ContractDocument;

// A reserved TLD (RFC 2606) and an invented token: neither names anything real.
const ENDPOINT = "https://collector.invalid";
const TOKEN = "placeholder_token";
const TOKEN_PLACEHOLDER = "<ingest token>";
const REFUSAL_CODE = "PLACEHOLDER_CODE";
const STATED_WAIT = "17";

/** What the collector does with each refusal the document names
 * (specs/0019-claude-code-collector/contracts/ingest-submission.md, "The answers"). */
const REFUSAL_OUTCOMES: Readonly<Record<string, DeliveryOutcome>> = {
  unauthenticated: { kind: "retain", reason: "reauthentication-required", stopDraining: true },
  rateLimited: { kind: "retain", reason: "rate-limited", stopDraining: true, detail: STATED_WAIT },
  invalidRequest: { kind: "discard", reason: "rejected-permanently", detail: REFUSAL_CODE },
};

const sorted = (values: Iterable<string>): string[] => [...values].sort();
const keysOf = (value: object): string[] => sorted(Object.keys(value));

const exampleBatches = contract.request.examples;
const exampleEntries = exampleBatches.flatMap((batch) => batch.measurements);

/** The turn a document entry would have been projected from. A field the service adds to an
 * example has to be fed here, in the change that teaches the projection to write it. */
function turnFrom(entry: ContractExampleEntry): UsageTurn {
  const turn = {
    messageId: entry.idempotencyKey,
    occurredAt: entry.occurredAt,
    model: entry.model,
    tokens: entry.tokens,
  };
  return entry.sessionId === undefined ? turn : { ...turn, sessionId: entry.sessionId };
}

function project(entry: ContractExampleEntry): MeasurementEntry {
  return projectMeasurement(turnFrom(entry), entry.pricingTier);
}

function respond(
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
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
    () => new AbortController().signal,
  );
}

function firstBatch(): IngestBatch {
  const [example] = exampleBatches;
  if (example === undefined) {
    throw new Error("the document holds no example request");
  }
  return { agent: example.agent, measurements: example.measurements.map(project) };
}

describe("the copy of the service's contract document", () => {
  it("is the one the provenance record names, byte for byte", () => {
    expect(createHash("sha256").update(copyBytes).digest("hex")).toBe(provenance.sha256);
  });

  it("is the contract and the version the record says it is", () => {
    expect(contract.contract).toBe("collector-ingest");
    expect(contract.version).toBe(provenance.version);
  });

  it("records a source commit that is unknown or whole", () => {
    expect(provenance.source.commit ?? "0".repeat(40)).toMatch(/^[0-9a-f]{40}$/);
  });

  it("shows a measurement with every optional field and one with none", () => {
    const optional = contract.request.measurementFields.whenKnown;
    const present = exampleEntries.map((entry) => optional.filter((field) => field in entry));
    expect(present.some((fields) => fields.length === optional.length)).toBe(true);
    expect(present.some((fields) => fields.length === 0)).toBe(true);
  });
});

describe("what the collector sends, against the service's contract", () => {
  it("posts to the pinned path", () => {
    expect(INGEST_PATH).toBe(contract.request.path);
  });

  it("declares exactly the pinned measurement fields", () => {
    const { always, whenKnown } = contract.request.measurementFields;
    expect(sorted(MEASUREMENT_ENTRY_FIELDS)).toEqual(sorted([...always, ...whenKnown]));
  });

  it("declares exactly the pinned token fields", () => {
    expect(sorted(TOKEN_FIELDS)).toEqual(sorted(contract.request.tokenFields));
  });

  it.each(exampleEntries.map((entry) => [entry.idempotencyKey, entry] as const))(
    "projects a turn to the key set of the example %s",
    (_name, entry) => {
      const projected = project(entry);
      expect(keysOf(projected)).toEqual(keysOf(entry));
      expect(keysOf(projected.tokens)).toEqual(keysOf(entry.tokens));
    },
  );

  it.each(exampleEntries.map((entry) => [entry.idempotencyKey, entry] as const))(
    "projects a turn to the example %s, value for value",
    (_name, entry) => {
      expect(project(entry)).toEqual(entry);
    },
  );

  it("builds a batch of exactly the pinned batch fields, for the pinned agent", () => {
    const batches = splitIntoBatches(CLAUDE_CODE_AGENT, exampleEntries.map(project), 1);

    expect(batches).toHaveLength(exampleEntries.length);
    for (const batch of batches) {
      expect(keysOf(batch)).toEqual(sorted(contract.request.batchFields));
    }
    expect(exampleBatches.map((example) => example.agent)).toEqual(
      exampleBatches.map(() => CLAUDE_CODE_AGENT),
    );
  });

  it("sends the request the document describes: method, address, headers and body", async () => {
    const calls: { url: string; init: HttpRequestInit }[] = [];
    const transport = transportWith(async (url, init) => {
      calls.push({ url, init });
      return respond(contract.accepted.status, contract.accepted.example);
    });

    await transport.deliver(firstBatch());

    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls as [{ url: string; init: HttpRequestInit }];
    expect(url).toBe(`${ENDPOINT}${contract.request.path}`);
    expect(init.method).toBe(contract.request.method);
    expect(keysOf(init.headers)).toEqual(keysOf(contract.request.headers));
    const expectedHeaders = Object.fromEntries(
      Object.entries(contract.request.headers).map(([name, value]) => [
        name,
        value.replace(TOKEN_PLACEHOLDER, TOKEN),
      ]),
    );
    expect(expectedHeaders.authorization).toContain(TOKEN);
    expect(init.headers).toEqual(expectedHeaders);
    expect(JSON.parse(init.body)).toEqual(exampleBatches[0]);
  });
});

describe("what the collector reads out of an answer, against the service's contract", () => {
  it("reads the pinned counts, and only those, out of the accepted example", () => {
    const { example, integerFields } = contract.accepted;
    const acceptance = readAcceptance(example);

    expect(acceptance).toBeDefined();
    expect(keysOf(acceptance ?? {})).toEqual(sorted(integerFields));
    expect(acceptance).toEqual(
      Object.fromEntries(integerFields.map((field) => [field, example[field]])),
    );
  });

  it.each(contract.accepted.integerFields)(
    "does not take an answer whose %s is not an integer for an acceptance",
    (field) => {
      expect(readAcceptance({ ...contract.accepted.example, [field]: "1" })).toBeUndefined();
    },
  );

  it("counts the accepted example, under the pinned status, as delivered", async () => {
    const { status, example, integerFields } = contract.accepted;
    const transport = transportWith(async () => respond(status, example));

    expect(await transport.deliver(firstBatch())).toEqual({
      kind: "accepted",
      ...Object.fromEntries(integerFields.map((field) => [field, example[field]])),
    });
  });

  it("recognises exactly the pinned actions", () => {
    expect(sorted(CLIENT_ACTIONS)).toEqual(sorted(contract.refused.actions));
  });

  it("reads exactly the pinned fields out of a refusal's body", () => {
    const [action] = contract.refused.actions;
    const body = { code: REFUSAL_CODE, action, message: "placeholder" };

    expect(keysOf(readServiceError(body))).toEqual(sorted(contract.refused.bodyFields));
  });

  it("has an expectation for every refusal the document names, and for no other", () => {
    expect(keysOf(REFUSAL_OUTCOMES)).toEqual(keysOf(contract.refused.cases));
  });

  it.each(Object.entries(contract.refused.cases))(
    "classifies the refusal %s as the design record says",
    async (name, refusal) => {
      const headers = refusal.header === undefined ? {} : { [refusal.header]: STATED_WAIT };
      const body = { code: REFUSAL_CODE, action: refusal.action, message: "placeholder" };
      const transport = transportWith(async () => respond(refusal.status, body, headers));

      expect(await transport.deliver(firstBatch())).toEqual(REFUSAL_OUTCOMES[name]);
    },
  );
});
