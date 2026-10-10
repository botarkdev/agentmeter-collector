import { createHmac } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Script, createContext } from "node:vm";

/**
 * The attribution rules a repository declares (specs/attribution-rules/decision.md).
 *
 * A repository commits `.agentmeter.json` at its root. Each rule names a source, a regular
 * expression over it, and the dimensions to emit when it matches. There are exactly two sources,
 * and the set is closed:
 *
 * - `branch` — the branch name recorded on a turn;
 * - `source` — the value of `AGENTMETER_SOURCE`, text the user chose to name where the metrics
 *   come from.
 *
 * What a dimension can hold is decided here and nowhere else: a `type` that is a constant of the
 * committed file, and a `key` that is the file's template with the named capture groups of the
 * rule's own pattern substituted in. There is no rule that reads a path, a title or content,
 * because there is no source for it, and a file that names one is refused whole.
 *
 * **Fail closed.** Anything this does not recognise — an unknown key at any level, an unknown
 * version, an unknown source, a placeholder naming no group — makes the whole file invalid, and
 * an invalid file means no dimensions at all. A key added by a later version, such as one that
 * says a dimension must be hashed, is therefore never ignored by this one.
 *
 * **How a key leaves the machine is decided here too** (specs/attribution-privacy/decision.md). A
 * version 2 file says, on every `emit` entry, whether its key is sent `plain`, `hashed` or
 * `omitted`; there is no default to fall back to, so an entry that does not say invalidates the
 * file. The treatment is applied in the one function that turns a match into a dimension, before
 * a dimension exists as a value: a key that is hashed or omitted never reaches a turn, a request,
 * the queue or a report in its plain form. A version 1 file has no treatments and is read exactly
 * as it always was.
 *
 * Nothing here throws, and nothing here can hold a run: a committed pattern can backtrack without
 * bound, so every match goes through `guardedMatch`, which interrupts it.
 */

export const ATTRIBUTION_FILE = ".agentmeter.json";

export const ATTRIBUTION_LIMITS = {
  fileBytes: 64 * 1024,
  rules: 32,
  emitsPerRule: 8,
  patternLength: 512,
  typeLength: 64,
  /** Of a key template as written, and of a key as sent. */
  keyLength: 128,
  /** Of a branch name or a source name handed to a pattern. */
  inputLength: 255,
  dimensionsPerMeasurement: 16,
  matchTimeoutMs: 50,
  hashSaltMinLength: 32,
  hashSaltMaxLength: 128,
  /** Hexadecimal characters of a digest that are sent: its first 128 bits. */
  digestLength: 32,
} as const;

/** One dimension of a turn: a word of the repository's file, and a key its rule built. */
export interface TurnDimension {
  readonly type: string;
  readonly key: string;
}

/**
 * Everything of a turn a rule can read. It has ONE field on purpose: the adapter that holds a
 * transcript event has no parameter through which a working directory, a title or a line of
 * content could be handed to a rule.
 */
export interface AttributionInput {
  readonly branch?: string;
}

export type Attributor = (input: AttributionInput) => readonly TurnDimension[];

/** Which check a file failed. Closed set: it is reported, and a report never quotes the file. */
export type RulesInvalidCode =
  | "not-json"
  | "too-large"
  | "invalid-shape"
  | "unknown-key"
  | "unsupported-version"
  | "unknown-source"
  | "invalid-pattern"
  | "unknown-placeholder"
  | "limit-exceeded"
  | "undeclared-treatment"
  | "invalid-hash-salt";

/** Everything a rule can read. Closed, and exported so that a test can hold a case for each. */
export const RULE_SOURCES = ["branch", "source"] as const;

export type RuleSource = (typeof RULE_SOURCES)[number];

/** How a key leaves the machine. Closed, and exported for the same reason. */
export const TREATMENTS = ["plain", "hashed", "omitted"] as const;

export type Treatment = (typeof TREATMENTS)[number];

/** What a hashed key begins with. Nothing else a version 2 file sends begins with it. */
export const HASHED_PREFIX = "hashed:";

/** A salt, a type and a key in; hexadecimal out. */
export type KeyDigest = (salt: string, type: string, key: string) => string;

/** A key template, split: literal text, and the names of the groups that go between. */
type KeyPart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "group"; readonly name: string };

/**
 * What an entry's treatment compiles to. `reservesPrefix` is false only for an entry of a version
 * 1 file, whose keys are sent exactly as that version always sent them. A hashed entry holds the
 * file's salt, so nothing has to carry it anywhere else.
 */
type EmitTreatment =
  | { readonly kind: "plain"; readonly reservesPrefix: boolean }
  | { readonly kind: "hashed"; readonly salt: string }
  | { readonly kind: "omitted" };

interface RuleEmit {
  readonly type: string;
  readonly key: readonly KeyPart[];
  /** Required: there is no way to compile an entry without saying how its key is sent. */
  readonly treatment: EmitTreatment;
}

export interface AttributionRule {
  readonly from: RuleSource;
  readonly pattern: RegExp;
  readonly emit: readonly RuleEmit[];
}

export type ParsedRules =
  | { readonly kind: "rules"; readonly rules: readonly AttributionRule[] }
  | { readonly kind: "invalid"; readonly code: RulesInvalidCode };

export type MatchResult =
  | { readonly kind: "match"; readonly groups: Readonly<Record<string, string | undefined>> }
  | { readonly kind: "no-match" }
  | { readonly kind: "timeout" };

export type RuleMatcher = (pattern: RegExp, text: string) => MatchResult;

interface MatchSandbox {
  pattern: RegExp | undefined;
  text: string;
}

const MATCH_SANDBOX: MatchSandbox = Object.assign(Object.create(null) as MatchSandbox, {
  pattern: undefined,
  text: "",
});
const MATCH_CONTEXT = createContext(MATCH_SANDBOX);
const MATCH_SCRIPT = new Script("pattern.exec(text)");

/**
 * One match, bounded in time.
 *
 * A synchronous `RegExp` match cannot be abandoned by the run's budget, and a pattern such as
 * `^(a+)+$` takes longer than a session close can wait on a few dozen characters. `node:vm` is the
 * built-in that can interrupt one. It is used for that and for nothing else: the pattern is data,
 * compiled outside the context, and the only code that ever runs inside is the fixed expression
 * above. It is a boundary for time, not for trust.
 *
 * Anything that goes wrong is reported as a timeout, which switches the rules off: an attribution
 * that cannot be computed is not sent.
 */
export const guardedMatch: RuleMatcher = (pattern, text) => {
  try {
    MATCH_SANDBOX.pattern = pattern;
    MATCH_SANDBOX.text = text;
    const result = MATCH_SCRIPT.runInContext(MATCH_CONTEXT, {
      timeout: ATTRIBUTION_LIMITS.matchTimeoutMs,
    }) as RegExpExecArray | null;
    if (result === null) {
      return { kind: "no-match" };
    }
    return { kind: "match", groups: { ...(result.groups ?? {}) } };
  } catch {
    return { kind: "timeout" };
  } finally {
    MATCH_SANDBOX.pattern = undefined;
    MATCH_SANDBOX.text = "";
  }
};

const RULE_KEYS = ["from", "match", "emit"];
const HASH_SALT = /^[A-Za-z0-9_-]+$/;
const DIGEST = new RegExp(`^[0-9a-f]{${ATTRIBUTION_LIMITS.digestLength}}$`);

/** What differs between the two versions of the file: its keys, an entry's keys, and whether an
 * entry says how its key is sent. Everything else is checked identically. */
interface FileVersion {
  readonly fileKeys: readonly string[];
  readonly emitKeys: readonly string[];
  readonly declaresTreatment: boolean;
}

const VERSION_1: FileVersion = {
  fileKeys: ["version", "attribution"],
  emitKeys: ["type", "key"],
  declaresTreatment: false,
};
const VERSION_2: FileVersion = {
  fileKeys: ["version", "attribution", "hashSalt"],
  emitKeys: ["type", "key", "send"],
  declaresTreatment: true,
};

/**
 * The digest of a key: HMAC-SHA-256 with the file's salt, over the JSON text of the pair — so a
 * type and a key cannot be re-split into another pair, and one text under two types does not show
 * as one value — cut to its first 128 bits.
 *
 * The salt is committed with the rules, so every checkout computes the same value and the service
 * can still group by it. It is not a credential: whoever reads the repository can confirm a
 * guessed name. What it stops is a reader of the service's data who cannot read the repository.
 */
export const saltedDigest: KeyDigest = (salt, type, key) =>
  createHmac("sha256", salt)
    .update(JSON.stringify([type, key]))
    .digest("hex")
    .slice(0, ATTRIBUTION_LIMITS.digestLength);
const PLACEHOLDER = /\{([A-Za-z_$][A-Za-z0-9_$]*)\}/g;

/** Thrown and caught inside this module only: the one way out of a nested validation. */
class InvalidRules extends Error {
  constructor(readonly code: RulesInvalidCode) {
    super(code);
  }
}

function refuse(code: RulesInvalidCode): never {
  throw new InvalidRules(code);
}

function recordOf(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return refuse("invalid-shape");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowed.includes(key))) {
    return refuse("unknown-key");
  }
  return record;
}

function textOf(value: unknown, limit: number): string {
  if (typeof value !== "string" || value.length === 0) {
    return refuse("invalid-shape");
  }
  if (value.length > limit) {
    return refuse("limit-exceeded");
  }
  return value;
}

function listOf(value: unknown, limit: number): readonly unknown[] {
  if (!Array.isArray(value)) {
    return refuse("invalid-shape");
  }
  if (value.length > limit) {
    return refuse("limit-exceeded");
  }
  return value;
}

/** The names of a pattern's groups, asked of the pattern itself: `(?:…)|` always matches the
 * empty text, and a match lists every named group whether or not it took part. */
function groupNamesOf(source: string, matcher: RuleMatcher): readonly string[] {
  let probe: RegExp;
  try {
    probe = new RegExp(`(?:${source})|`);
  } catch {
    return refuse("invalid-pattern");
  }
  const result = matcher(probe, "");
  if (result.kind !== "match") {
    return refuse("invalid-pattern");
  }
  return Object.keys(result.groups);
}

function keyPartsOf(template: string, groupNames: readonly string[]): readonly KeyPart[] {
  const parts: KeyPart[] = [];
  let index = 0;
  for (const placeholder of template.matchAll(PLACEHOLDER)) {
    const name = placeholder[1] as string;
    if (!groupNames.includes(name)) {
      return refuse("unknown-placeholder");
    }
    if (placeholder.index > index) {
      parts.push({ kind: "text", text: template.slice(index, placeholder.index) });
    }
    parts.push({ kind: "group", name });
    index = placeholder.index + placeholder[0].length;
  }
  if (index < template.length) {
    parts.push({ kind: "text", text: template.slice(index) });
  }
  // A brace left over is a placeholder somebody mistyped. Sending it literally would be a key
  // nobody meant.
  if (parts.some((part) => part.kind === "text" && /[{}]/.test(part.text))) {
    return refuse("unknown-placeholder");
  }
  return parts;
}

/** The file's salt, or nothing when it holds none. A salt that is there and not usable invalidates
 * the file whether or not an entry asks for it: a file is not half read. */
function hashSaltOf(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "string" ||
    value.length < ATTRIBUTION_LIMITS.hashSaltMinLength ||
    value.length > ATTRIBUTION_LIMITS.hashSaltMaxLength ||
    !HASH_SALT.test(value)
  ) {
    return refuse("invalid-hash-salt");
  }
  return value;
}

/** How an entry says its key is sent. One of the three words, written out: anything else — a word
 * this version does not know, or no word at all — is refused, never read as `plain`. */
function treatmentOf(value: unknown, salt: string | undefined): EmitTreatment {
  const send = TREATMENTS.find((treatment) => treatment === value);
  switch (send) {
    case "plain":
      return { kind: "plain", reservesPrefix: true };
    case "omitted":
      return { kind: "omitted" };
    case "hashed":
      return salt === undefined ? refuse("invalid-hash-salt") : { kind: "hashed", salt };
    case undefined:
      return refuse("undeclared-treatment");
  }
}

/** What every entry of a version 1 file is sent as: what that version always sent. */
const AS_VERSION_1_SENT: EmitTreatment = { kind: "plain", reservesPrefix: false };

function emitOf(
  value: unknown,
  groupNames: readonly string[],
  version: FileVersion,
  salt: string | undefined,
): RuleEmit {
  const record = recordOf(value, version.emitKeys);
  const type = textOf(record.type, ATTRIBUTION_LIMITS.typeLength);
  // A type is the repository's own word and is never built from anything on the machine.
  if (/[{}]/.test(type)) {
    return refuse("unknown-placeholder");
  }
  const template = textOf(record.key, ATTRIBUTION_LIMITS.keyLength);
  const treatment = version.declaresTreatment ? treatmentOf(record.send, salt) : AS_VERSION_1_SENT;
  return { type, key: keyPartsOf(template, groupNames), treatment };
}

function ruleOf(
  value: unknown,
  matcher: RuleMatcher,
  version: FileVersion,
  salt: string | undefined,
): AttributionRule {
  const record = recordOf(value, RULE_KEYS);
  if (typeof record.from !== "string") {
    return refuse("invalid-shape");
  }
  const from = RULE_SOURCES.find((source) => source === record.from);
  if (from === undefined) {
    return refuse("unknown-source");
  }
  const source = textOf(record.match, ATTRIBUTION_LIMITS.patternLength);
  let pattern: RegExp;
  try {
    pattern = new RegExp(source);
  } catch {
    return refuse("invalid-pattern");
  }
  const groupNames = groupNamesOf(source, matcher);
  const emits = listOf(record.emit, ATTRIBUTION_LIMITS.emitsPerRule);
  if (emits.length === 0) {
    return refuse("invalid-shape");
  }
  return {
    from,
    pattern,
    emit: emits.map((emit) => emitOf(emit, groupNames, version, salt)),
  };
}

/** The text of a rule file in; compiled rules, or the code of the first check it failed, out. */
export function parseAttributionRules(
  text: string,
  matcher: RuleMatcher = guardedMatch,
): ParsedRules {
  try {
    if (Buffer.byteLength(text, "utf8") > ATTRIBUTION_LIMITS.fileBytes) {
      return refuse("too-large");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return refuse("not-json");
    }
    // A file's keys are those of the version it names; a file that names no version this knows
    // is held to the first one's, so that it is refused for the first thing wrong with it.
    const version = (parsed as { version?: unknown } | null)?.version === 2 ? VERSION_2 : VERSION_1;
    const file = recordOf(parsed, version.fileKeys);
    if (file.version !== 1 && file.version !== 2) {
      return refuse("unsupported-version");
    }
    const salt = hashSaltOf(file.hashSalt);
    const rules = listOf(file.attribution, ATTRIBUTION_LIMITS.rules);
    return { kind: "rules", rules: rules.map((rule) => ruleOf(rule, matcher, version, salt)) };
  } catch (error) {
    return { kind: "invalid", code: error instanceof InvalidRules ? error.code : "invalid-shape" };
  }
}

export interface AttributorOptions {
  /** The declared source name, already bounded by the configuration. Absent: not set. */
  readonly source?: string;
  readonly matcher?: RuleMatcher;
  /** The digest of a hashed key. Replaced only by a test. */
  readonly digest?: KeyDigest;
}

export interface AttributionState {
  readonly attribute: Attributor;
  /** True once a pattern did not answer in time. From then on `attribute` returns nothing. */
  readonly timedOut: () => boolean;
}

interface RuleOutput {
  readonly index: number;
  readonly dimensions: readonly TurnDimension[];
}

function keyOf(parts: readonly KeyPart[], groups: MatchGroups): string | undefined {
  let key = "";
  for (const part of parts) {
    if (part.kind === "text") {
      key += part.text;
      continue;
    }
    const captured = groups[part.name];
    if (captured === undefined) {
      return undefined;
    }
    key += captured;
  }
  return key.length === 0 || key.length > ATTRIBUTION_LIMITS.keyLength ? undefined : key;
}

type MatchGroups = Readonly<Record<string, string | undefined>>;

/**
 * The key as it leaves the machine, or nothing.
 *
 * This is the only place a plain key becomes something that is sent, and it has one path that
 * returns the plain key: the entry says `plain`. A digest that cannot be computed, or that does
 * not come back as a digest, is no dimension — never the key it was asked about.
 */
function treated(emit: RuleEmit, plain: string, digest: KeyDigest): string | undefined {
  const treatment = emit.treatment;
  switch (treatment.kind) {
    case "plain":
      return treatment.reservesPrefix && plain.startsWith(HASHED_PREFIX) ? undefined : plain;
    case "omitted":
      return undefined;
    case "hashed":
      try {
        const hex = digest(treatment.salt, emit.type, plain);
        return typeof hex === "string" && DIGEST.test(hex) ? `${HASHED_PREFIX}${hex}` : undefined;
      } catch {
        return undefined;
      }
  }
}

function dimensionsOf(
  rule: AttributionRule,
  groups: MatchGroups,
  digest: KeyDigest,
): TurnDimension[] {
  const dimensions: TurnDimension[] = [];
  for (const emit of rule.emit) {
    // An entry is dropped for the same reasons under every treatment, so changing how a key is
    // sent never changes which turns are labelled.
    const plain = keyOf(emit.key, groups);
    const key = plain === undefined ? undefined : treated(emit, plain, digest);
    if (key !== undefined) {
      dimensions.push({ type: emit.type, key });
    }
  }
  return dimensions;
}

/** Rule order, identical pairs once, and no more than a measurement may carry. */
function merge(outputs: readonly RuleOutput[]): readonly TurnDimension[] {
  const merged: TurnDimension[] = [];
  const seen = new Set<string>();
  for (const output of [...outputs].sort((a, b) => a.index - b.index)) {
    for (const dimension of output.dimensions) {
      const identity = JSON.stringify([dimension.type, dimension.key]);
      if (seen.has(identity) || merged.length >= ATTRIBUTION_LIMITS.dimensionsPerMeasurement) {
        continue;
      }
      seen.add(identity);
      merged.push(dimension);
    }
  }
  return merged;
}

const NOTHING: readonly TurnDimension[] = [];

/**
 * Turns compiled rules into the function the adapter is handed.
 *
 * Rules are tried in the order written, separately for each source: the first `branch` rule that
 * matches emits, and the first `source` rule that matches emits. The two answer different
 * questions, so a rule of one never shadows a rule of the other.
 *
 * The source name is bound here, once, and matched once: it is the same for every turn of a run.
 * It never passes through the adapter, whose only input is `AttributionInput`. A branch's result
 * is remembered, so a run asks its patterns once per distinct branch rather than once per turn.
 */
export function buildAttributor(
  rules: readonly AttributionRule[],
  options: AttributorOptions = {},
): AttributionState {
  const matcher = options.matcher ?? guardedMatch;
  const digest = options.digest ?? saltedDigest;
  let disabled = false;

  const firstMatch = (from: RuleSource, text: string | undefined): RuleOutput | undefined => {
    if (text === undefined || text.length > ATTRIBUTION_LIMITS.inputLength) {
      return undefined;
    }
    for (const [index, rule] of rules.entries()) {
      if (rule.from !== from) {
        continue;
      }
      const result = matcher(rule.pattern, text);
      if (result.kind === "timeout") {
        disabled = true;
        return undefined;
      }
      if (result.kind === "match") {
        return { index, dimensions: dimensionsOf(rule, result.groups, digest) };
      }
    }
    return undefined;
  };

  const fromSource = firstMatch("source", options.source);
  const byBranch = new Map<string, readonly TurnDimension[]>();
  const withoutBranch = fromSource === undefined ? NOTHING : merge([fromSource]);

  const attribute: Attributor = (input) => {
    if (disabled) {
      return NOTHING;
    }
    const branch = input.branch;
    if (branch === undefined) {
      return withoutBranch;
    }
    const known = byBranch.get(branch);
    if (known !== undefined) {
      return known;
    }
    const fromBranch = firstMatch("branch", branch);
    if (disabled) {
      return NOTHING;
    }
    const outputs = [fromSource, fromBranch].filter((output) => output !== undefined);
    const dimensions = outputs.length === 0 ? NOTHING : merge(outputs);
    byBranch.set(branch, dimensions);
    return dimensions;
  };

  return { attribute, timedOut: () => disabled };
}

export type RulesFile =
  | { readonly kind: "absent" }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "too-large" }
  | { readonly kind: "unreadable" };

export type RulesFileReader = (path: string) => Promise<RulesFile>;

function isMissing(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** Reads the rule file, and never more of it than a rule file may be. Never rejects. */
export const readRulesFile: RulesFileReader = async (path) => {
  try {
    const stats = await stat(path);
    if (!stats.isFile()) {
      return { kind: "unreadable" };
    }
    if (stats.size > ATTRIBUTION_LIMITS.fileBytes) {
      return { kind: "too-large" };
    }
    return { kind: "text", text: await readFile(path, "utf8") };
  } catch (error) {
    return isMissing(error) ? { kind: "absent" } : { kind: "unreadable" };
  }
};

export type LoadedRules =
  /** No file: every repository that never declared rules. Not a failure. */
  | { readonly kind: "none" }
  | { readonly kind: "rules"; readonly rules: readonly AttributionRule[] }
  | {
      readonly kind: "failed";
      readonly reason: "invalid-rules" | "unreadable-rules";
      readonly detail?: RulesInvalidCode;
    };

/** The rules of the repository at `repositoryRoot`. Never rejects. */
export async function loadAttributionRules(
  repositoryRoot: string,
  read: RulesFileReader = readRulesFile,
  matcher: RuleMatcher = guardedMatch,
): Promise<LoadedRules> {
  let file: RulesFile;
  try {
    file = await read(join(repositoryRoot, ATTRIBUTION_FILE));
  } catch {
    return { kind: "failed", reason: "unreadable-rules" };
  }
  if (file.kind === "absent") {
    return { kind: "none" };
  }
  if (file.kind === "unreadable") {
    return { kind: "failed", reason: "unreadable-rules" };
  }
  if (file.kind === "too-large") {
    return { kind: "failed", reason: "invalid-rules", detail: "too-large" };
  }
  const parsed = parseAttributionRules(file.text, matcher);
  return parsed.kind === "rules"
    ? { kind: "rules", rules: parsed.rules }
    : { kind: "failed", reason: "invalid-rules", detail: parsed.code };
}
