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
export declare const ATTRIBUTION_FILE = ".agentmeter.json";
export declare const ATTRIBUTION_LIMITS: {
    readonly fileBytes: number;
    readonly rules: 32;
    readonly emitsPerRule: 8;
    readonly patternLength: 512;
    readonly typeLength: 64;
    /** Of a key template as written, and of a key as sent. */
    readonly keyLength: 128;
    /** Of a branch name or a source name handed to a pattern. */
    readonly inputLength: 255;
    readonly dimensionsPerMeasurement: 16;
    readonly matchTimeoutMs: 50;
};
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
export type RulesInvalidCode = "not-json" | "too-large" | "invalid-shape" | "unknown-key" | "unsupported-version" | "unknown-source" | "invalid-pattern" | "unknown-placeholder" | "limit-exceeded";
export type RuleSource = "branch" | "source";
/** A key template, split: literal text, and the names of the groups that go between. */
type KeyPart = {
    readonly kind: "text";
    readonly text: string;
} | {
    readonly kind: "group";
    readonly name: string;
};
interface RuleEmit {
    readonly type: string;
    readonly key: readonly KeyPart[];
}
export interface AttributionRule {
    readonly from: RuleSource;
    readonly pattern: RegExp;
    readonly emit: readonly RuleEmit[];
}
export type ParsedRules = {
    readonly kind: "rules";
    readonly rules: readonly AttributionRule[];
} | {
    readonly kind: "invalid";
    readonly code: RulesInvalidCode;
};
export type MatchResult = {
    readonly kind: "match";
    readonly groups: Readonly<Record<string, string | undefined>>;
} | {
    readonly kind: "no-match";
} | {
    readonly kind: "timeout";
};
export type RuleMatcher = (pattern: RegExp, text: string) => MatchResult;
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
export declare const guardedMatch: RuleMatcher;
/** The text of a rule file in; compiled rules, or the code of the first check it failed, out. */
export declare function parseAttributionRules(text: string, matcher?: RuleMatcher): ParsedRules;
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
export declare function buildAttributor(rules: readonly AttributionRule[], options?: AttributorOptions): AttributionState;
export type RulesFile = {
    readonly kind: "absent";
} | {
    readonly kind: "text";
    readonly text: string;
} | {
    readonly kind: "too-large";
} | {
    readonly kind: "unreadable";
};
export type RulesFileReader = (path: string) => Promise<RulesFile>;
/** Reads the rule file, and never more of it than a rule file may be. Never rejects. */
export declare const readRulesFile: RulesFileReader;
export type LoadedRules = 
/** No file: every repository that never declared rules. Not a failure. */
{
    readonly kind: "none";
} | {
    readonly kind: "rules";
    readonly rules: readonly AttributionRule[];
} | {
    readonly kind: "failed";
    readonly reason: "invalid-rules" | "unreadable-rules";
    readonly detail?: RulesInvalidCode;
};
/** The rules of the repository at `repositoryRoot`. Never rejects. */
export declare function loadAttributionRules(repositoryRoot: string, read?: RulesFileReader, matcher?: RuleMatcher): Promise<LoadedRules>;
export {};
