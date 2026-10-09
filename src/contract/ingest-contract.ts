/**
 * The service's ingestion contract, as this collector consumes it
 * (specs/0019-claude-code-collector/contracts/ingest-submission.md).
 *
 * The authority is the deployed endpoint. What this collector relies on of it is pinned by the
 * service in one document, `apps/api/contracts/collector-ingest.json` of its repository
 * (`botarkdev/agentmeter`, private). A copy is held here as
 * `test/fixtures/collector-ingest.contract.json`, and
 * `test/unit/contract/service-contract.unit.test.ts` fails when this collector departs from it.
 * Nothing here changes the contract, and nothing here re-validates it: a rule of the service's
 * repository requires a schema shared between the API and the collector to live in a shared
 * package rather than be duplicated, so this package defines no second copy of that schema. What
 * it defines is the TypeScript shape of the payload its allowlist projection builds, and the
 * service remains the authority that validates (research.md Decision 10).
 */

export const CLAUDE_CODE_AGENT = "claude-code";

/** Every HTTP API is served under `/api/v1` (Constitution, API Design & Documentation). */
export const INGEST_PATH = "/api/v1/ingest";

export interface WireTokenCounts {
  readonly input: number;
  readonly output: number;
  readonly cacheWrite5m: number;
  readonly cacheWrite1h: number;
  readonly cacheRead: number;
}

/**
 * One measurement on the wire. This is the COMPLETE set of fields this collector ever sends:
 * no `payload`, no `dimensions` (attribution is TASKRAIL.md row T013, and deriving one here would
 * mean reading the very fields FR-025 keeps off the wire), and no project or user identity —
 * both are the service's to derive from the token, and no request field can influence either.
 */
export interface MeasurementEntry {
  readonly idempotencyKey: string;
  readonly occurredAt: string;
  readonly sessionId?: string;
  readonly model: string;
  readonly pricingTier: string;
  readonly tokens: WireTokenCounts;
}

export interface IngestBatch {
  readonly agent: string;
  readonly measurements: readonly MeasurementEntry[];
}

/** The service's `200` body, as far as this collector needs to recognise it. */
export interface IngestAcceptance {
  readonly accepted: number;
  readonly deduplicated: number;
  readonly rejected: number;
}

/**
 * Builds the ingestion URL from a configured base. Trailing slashes are tolerated because a
 * developer pasting a base URL into an environment variable will sometimes include one, and a
 * silent `//` in the path is a 404 nobody diagnoses quickly.
 */
export function ingestUrl(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, "")}${INGEST_PATH}`;
}

/**
 * Splits measurements into batches of at most `maxBatchSize` entries.
 *
 * Bounded by entry COUNT rather than by serialized bytes on purpose: the endpoint's rate limits
 * are counted in individual measurement entries (specs/0017-ingestion-rate-limiting), so the
 * count is the dimension that actually constrains a client. The endpoint's separate 1 MiB body
 * limit is respected with room to spare — an entry serialises to a few hundred bytes, so the
 * default 200 is two orders of magnitude inside it.
 *
 * Never produces an empty batch: an empty `measurements` array is a valid request the service
 * treats as a no-op, but sending one spends a round trip out of the run's budget to accomplish
 * nothing.
 */
export function splitIntoBatches(
  agent: string,
  measurements: readonly MeasurementEntry[],
  maxBatchSize: number,
): IngestBatch[] {
  const size = Math.max(1, Math.floor(maxBatchSize));
  const batches: IngestBatch[] = [];
  for (let index = 0; index < measurements.length; index += size) {
    batches.push({ agent, measurements: measurements.slice(index, index + size) });
  }
  return batches;
}

/** Recognises the documented `200` body. Anything else — a proxy's HTML error page served with a
 * 200, a redirect landing page, a future response shape — is NOT delivery, and the caller retains
 * the batch (FR-020). */
export function readAcceptance(body: unknown): IngestAcceptance | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const record = body as Record<string, unknown>;
  const { accepted, deduplicated, rejected } = record;
  if (
    !Number.isInteger(accepted) ||
    !Number.isInteger(deduplicated) ||
    !Number.isInteger(rejected)
  ) {
    return undefined;
  }
  return {
    accepted: accepted as number,
    deduplicated: deduplicated as number,
    rejected: rejected as number,
  };
}

/** The closed set of values the service's error contract uses for "what should the client do
 * next" (`refused.actions` in the service's pinned document, which the service compares with its
 * own list exactly: a value outside this list is read here as no action at all). Read to decide
 * whether a batch is retained or discarded (FR-021). */
export const CLIENT_ACTIONS = ["RETRY", "DO_NOT_RETRY", "FIX_AND_RETRY", "REAUTHENTICATE"] as const;

export type ClientAction = (typeof CLIENT_ACTIONS)[number];

export interface ServiceError {
  readonly code?: string;
  readonly action?: ClientAction;
}

export function readServiceError(body: unknown): ServiceError {
  if (typeof body !== "object" || body === null) {
    return {};
  }
  const record = body as Record<string, unknown>;
  const action = CLIENT_ACTIONS.find((candidate) => candidate === record.action);
  const code = typeof record.code === "string" && record.code.length > 0 ? record.code : undefined;
  if (action === undefined) {
    return code === undefined ? {} : { code };
  }
  return code === undefined ? { action } : { code, action };
}
