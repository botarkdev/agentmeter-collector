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
  | "limit-exceeded";

export type RuleSource = "branch" | "source";

/** A key template, split: literal text, and the names of the groups that go between. */
type KeyPart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "group"; readonly name: string };

interface RuleEmit {
  readonly type: string;
  readonly key: readonly KeyPart[];
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

const FILE_KEYS = ["version", "attribution"];
const RULE_KEYS = ["from", "match", "emit"];
const EMIT_KEYS = ["type", "key"];
const SOURCES: readonly RuleSource[] = ["branch", "source"];
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

function emitOf(value: unknown, groupNames: readonly string[]): RuleEmit {
  const record = recordOf(value, EMIT_KEYS);
  const type = textOf(record.type, ATTRIBUTION_LIMITS.typeLength);
  // A type is the repository's own word and is never built from anything on the machine.
  if (/[{}]/.test(type)) {
    return refuse("unknown-placeholder");
  }
  const template = textOf(record.key, ATTRIBUTION_LIMITS.keyLength);
  return { type, key: keyPartsOf(template, groupNames) };
}

function ruleOf(value: unknown, matcher: RuleMatcher): AttributionRule {
  const record = recordOf(value, RULE_KEYS);
  if (typeof record.from !== "string") {
    return refuse("invalid-shape");
  }
  const from = SOURCES.find((source) => source === record.from);
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
  return { from, pattern, emit: emits.map((emit) => emitOf(emit, groupNames)) };
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
    const file = recordOf(parsed, FILE_KEYS);
    if (file.version !== 1) {
      return refuse("unsupported-version");
    }
    const rules = listOf(file.attribution, ATTRIBUTION_LIMITS.rules);
    return { kind: "rules", rules: rules.map((rule) => ruleOf(rule, matcher)) };
  } catch (error) {
    return { kind: "invalid", code: error instanceof InvalidRules ? error.code : "invalid-shape" };
  }
}

export interface AttributorOptions {
  /** The declared source name, already bounded by the configuration. Absent: not set. */
  readonly source?: string;
  readonly matcher?: RuleMatcher;
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

function dimensionsOf(rule: AttributionRule, groups: MatchGroups): TurnDimension[] {
  const dimensions: TurnDimension[] = [];
  for (const emit of rule.emit) {
    const key = keyOf(emit.key, groups);
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
        return { index, dimensions: dimensionsOf(rule, result.groups) };
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
