import type { Attributor, TurnDimension } from "../attribution/attribution-rules.js";
import type { SkipReason } from "../run/run-outcome.js";

/**
 * The content boundary of this package.
 *
 * This module is the ONLY one that ever holds a parsed transcript event. Everything downstream
 * sees `UsageTurn`, which has five fields, five counters and a list of dimensions, and no
 * representation for message content, tool input or output, file contents, `cwd`, `gitBranch`,
 * `slug`, `entrypoint`, `error`, `uuid` or anything else a transcript carries. That is not a
 * convention to be remembered at review time — there is simply no field for those things to
 * travel in (spec.md FR-024, FR-025; research.md Decision 5).
 *
 * Two of those fields are READ here, and still never carried:
 *
 * - a turn's `cwd` is handed to the scope a run was given, which answers whether the turn belongs
 *   to the repository being reported, and is then dropped (specs/repository-scope/decision.md).
 *   Selecting a turn by a path is not transmitting the path.
 * - a turn's `gitBranch` is handed to the attribution function a run was given, which answers
 *   with the dimensions the repository's committed rules derive from it, and is then dropped
 *   (specs/attribution-rules/decision.md). What travels is what a rule captured; the name does
 *   not. It is the only thing of the event that function is ever shown.
 *
 * A session's name and its generated title are written as events of their own (`custom-title`,
 * `agent-name`, `ai-title`). They are not assistant turns, so they are ignored by the first check
 * below like every other line that is not usage, and nothing here reads them: a name the user
 * typed and one generated from the conversation are recorded identically, so neither is sent.
 *
 * Nothing here throws. A line that is not usage is ignored; a line that looks like usage but
 * cannot be turned into a measurement is skipped with a reason that is counted and reported
 * (spec.md FR-028).
 */

export interface TokenCounts {
  readonly input: number;
  readonly output: number;
  readonly cacheWrite5m: number;
  readonly cacheWrite1h: number;
  readonly cacheRead: number;
}

export interface UsageTurn {
  readonly messageId: string;
  readonly occurredAt: string;
  readonly sessionId?: string;
  readonly model: string;
  readonly tokens: TokenCounts;
  /** What the repository's rules derived for this turn. Absent when they derived nothing, or
   * when the run has no rules. */
  readonly dimensions?: readonly TurnDimension[];
}

export type ExtractionResult =
  /** Not an assistant turn carrying usage — the overwhelming majority of transcript lines. Not
   * reported, because reporting it would drown every genuine skip in noise. */
  | { readonly kind: "ignored" }
  /** A usage turn of another repository. Counted, so a scope that matches nothing is visible,
   * but not a skip: nothing is wrong with it. */
  | { readonly kind: "out-of-scope" }
  /** Looked like usage but cannot be submitted. Counted and reported. */
  | { readonly kind: "skipped"; readonly reason: SkipReason }
  | { readonly kind: "turn"; readonly turn: UsageTurn };

const IGNORED: ExtractionResult = { kind: "ignored" };
const OUT_OF_SCOPE: ExtractionResult = { kind: "out-of-scope" };

/** Answers whether a turn that ran in this working directory is to be reported. */
export type WorkingDirectoryFilter = (workingDirectory: string | undefined) => boolean;

function skipped(reason: SkipReason): ExtractionResult {
  return { kind: "skipped", reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * One token counter. Absent (or null) means zero, exactly as the reference implementation's `?? 0`
 * treats it. Anything present that is not a non-negative integer makes the whole turn malformed —
 * a fractional or negative count is a shape this collector does not understand, and guessing at
 * it would submit a number nobody measured.
 */
function counter(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return 0;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return undefined;
  }
  return value;
}

/**
 * The five buckets, derived exactly as `scripts/usage-report.mjs` derives them (spec.md FR-005;
 * research.md Decision 4):
 *
 * - `cacheWrite1h` is the itemised 1-hour ephemeral count.
 * - `cacheWrite5m` is the itemised 5-minute count when present, and otherwise the flat
 *   `cache_creation_input_tokens` minus the 1-hour count, floored at zero. The fallback is what
 *   keeps older transcripts — the ones predating the itemised `cache_creation` object — readable.
 *
 * `usage.service_tier` is deliberately NOT read: it is the API's standard/batch/priority service
 * class, not the introductory-versus-standard PRICING tier the service's contract means, and
 * conflating the two would misprice every measurement (research.md Decision 4).
 */
function readTokenCounts(usage: Record<string, unknown>): TokenCounts | undefined {
  const creation = isRecord(usage.cache_creation) ? usage.cache_creation : undefined;

  const input = counter(usage.input_tokens);
  const output = counter(usage.output_tokens);
  const cacheRead = counter(usage.cache_read_input_tokens);
  const cacheWrite1h = counter(creation?.ephemeral_1h_input_tokens);
  if (
    input === undefined ||
    output === undefined ||
    cacheRead === undefined ||
    cacheWrite1h === undefined
  ) {
    return undefined;
  }

  const itemised5m = creation?.ephemeral_5m_input_tokens;
  let cacheWrite5m: number | undefined;
  if (itemised5m !== undefined && itemised5m !== null) {
    cacheWrite5m = counter(itemised5m);
  } else {
    const flat = counter(usage.cache_creation_input_tokens);
    cacheWrite5m = flat === undefined ? undefined : Math.max(0, flat - cacheWrite1h);
  }
  if (cacheWrite5m === undefined) {
    return undefined;
  }

  return { input, output, cacheWrite5m, cacheWrite1h, cacheRead };
}

export function totalTokens(tokens: TokenCounts): number {
  return (
    tokens.input + tokens.output + tokens.cacheWrite5m + tokens.cacheWrite1h + tokens.cacheRead
  );
}

/**
 * Asks the run's attribution function about one turn. The branch goes in as the single property
 * of an object built here, and what comes back is copied property by property, so the function
 * is shown nothing else of the event and can put nothing else on the turn.
 */
function dimensionsFor(recordedBranch: unknown, attribute: Attributor): TurnDimension[] {
  const branch = nonEmptyString(recordedBranch);
  const derived = attribute(branch === undefined ? {} : { branch });
  const dimensions: TurnDimension[] = [];
  for (const dimension of derived) {
    dimensions.push({ type: dimension.type, key: dimension.key });
  }
  return dimensions;
}

/**
 * A parsed transcript line in; a `UsageTurn`, a counted skip, or nothing, out.
 *
 * The key is `message.id` alone (research.md Decision 1). Measured over 60 real transcripts:
 * 5 616 of 8 667 message ids appear on more than one line, 404 appear under more than one session
 * id after a resume, 14 turns carry no `requestId` at all, and no id was ever seen under two
 * different request ids. So the id alone deduplicates everything the composite would, keys the
 * turns the composite cannot, and — unlike anything containing the session id — survives a
 * resumed session without charging its earlier turns twice.
 *
 * `accepts`, when given, is asked before anything else is checked: a turn of another repository
 * is none of this run's business, and reporting its missing model as a skip would fill one
 * repository's outcome with another's anomalies.
 *
 * `attribute`, when given, is asked last, about a turn that is going to be reported, and is
 * handed an object built here with the branch as its one property — never the event.
 */
export function extractUsageTurn(
  value: unknown,
  accepts?: WorkingDirectoryFilter,
  attribute?: Attributor,
): ExtractionResult {
  if (!isRecord(value) || value.type !== "assistant") {
    return IGNORED;
  }
  const message = value.message;
  if (!isRecord(message) || !isRecord(message.usage)) {
    return IGNORED;
  }
  if (accepts !== undefined && !accepts(nonEmptyString(value.cwd))) {
    return OUT_OF_SCOPE;
  }

  const messageId = nonEmptyString(message.id);
  if (messageId === undefined) {
    return skipped("missing-key");
  }
  const occurredAt = nonEmptyString(value.timestamp);
  if (occurredAt === undefined) {
    return skipped("missing-timestamp");
  }
  const model = nonEmptyString(message.model);
  if (model === undefined) {
    return skipped("missing-model");
  }

  const tokens = readTokenCounts(message.usage);
  if (tokens === undefined) {
    return skipped("invalid-token-counts");
  }
  // A turn contributing to none of the five buckets measures nothing. This is also what removes
  // Claude Code's `<synthetic>` placeholder turns without this package having to know that name —
  // all 21 observed carried zero in every bucket (research.md Decision 3).
  if (totalTokens(tokens) === 0) {
    return skipped("zero-token-turn");
  }

  const sessionId = nonEmptyString(value.sessionId) ?? nonEmptyString(value.session_id);
  const dimensions = attribute === undefined ? [] : dimensionsFor(value.gitBranch, attribute);
  if (dimensions.length === 0) {
    if (sessionId === undefined) {
      return { kind: "turn", turn: { messageId, occurredAt, model, tokens } };
    }
    return { kind: "turn", turn: { messageId, occurredAt, sessionId, model, tokens } };
  }
  if (sessionId === undefined) {
    return { kind: "turn", turn: { messageId, occurredAt, model, tokens, dimensions } };
  }
  return { kind: "turn", turn: { messageId, occurredAt, sessionId, model, tokens, dimensions } };
}
