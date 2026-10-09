import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ATTRIBUTION_FILE,
  ATTRIBUTION_LIMITS,
  buildAttributor,
  guardedMatch,
  loadAttributionRules,
  parseAttributionRules,
  readRulesFile,
  type AttributionRule,
  type RuleMatcher,
  type RulesInvalidCode,
} from "../../../src/attribution/attribution-rules.js";
import { makeTempDir } from "../support/transcripts.js";

/**
 * The rules a repository declares (specs/attribution-rules/decision.md).
 *
 * Every branch name, source name and vocabulary word below is invented.
 */

const TASK_RULE = {
  from: "branch",
  match: "^(?<task>[A-Z][0-9]{3})-",
  emit: [{ type: "task", key: "{task}" }],
};
const SOURCE_RULE = {
  from: "source",
  match: "^(?<name>[a-z0-9-]+)$",
  emit: [{ type: "checkout", key: "{name}" }],
};

function fileOf(attribution: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ version: 1, attribution, ...extra });
}

function rulesOf(attribution: unknown): readonly AttributionRule[] {
  const parsed = parseAttributionRules(fileOf(attribution));
  if (parsed.kind !== "rules") {
    throw new Error(`fixture rules must be valid, got ${parsed.code}`);
  }
  return parsed.rules;
}

function invalidCode(text: string): RulesInvalidCode | "valid" {
  const parsed = parseAttributionRules(text);
  return parsed.kind === "invalid" ? parsed.code : "valid";
}

describe("parseAttributionRules: a valid file", () => {
  it("accepts the two sources and nothing has to be declared but the rules", () => {
    expect(parseAttributionRules(fileOf([TASK_RULE, SOURCE_RULE])).kind).toBe("rules");
  });

  it("accepts a file that declares no rule at all", () => {
    expect(rulesOf([])).toEqual([]);
  });
});

describe("parseAttributionRules: fail closed", () => {
  it.each<[string, string, RulesInvalidCode]>([
    ["text that is not JSON", "{ not json", "not-json"],
    ["a JSON value that is not an object", "[]", "invalid-shape"],
    ["a file with no version", JSON.stringify({ attribution: [] }), "unsupported-version"],
    [
      "a version it does not know",
      JSON.stringify({ version: 2, attribution: [] }),
      "unsupported-version",
    ],
    ["a file with no rule list", JSON.stringify({ version: 1 }), "invalid-shape"],
    ["a rule list that is not a list", fileOf({}), "invalid-shape"],
    ["a rule that is not an object", fileOf(["branch"]), "invalid-shape"],
    ["a rule with no pattern", fileOf([{ from: "branch", emit: TASK_RULE.emit }]), "invalid-shape"],
    ["a rule that emits nothing", fileOf([{ ...TASK_RULE, emit: [] }]), "invalid-shape"],
    [
      "an emit entry with no key",
      fileOf([{ ...TASK_RULE, emit: [{ type: "task" }] }]),
      "invalid-shape",
    ],
    [
      "an empty type",
      fileOf([{ ...TASK_RULE, emit: [{ type: "", key: "{task}" }] }]),
      "invalid-shape",
    ],
    ["a pattern that does not compile", fileOf([{ ...TASK_RULE, match: "(" }]), "invalid-pattern"],
    [
      "a key placeholder naming no group of its pattern",
      fileOf([{ ...TASK_RULE, emit: [{ type: "task", key: "{spec}" }] }]),
      "unknown-placeholder",
    ],
    [
      "a key with a brace that is not a placeholder",
      fileOf([{ ...TASK_RULE, emit: [{ type: "task", key: "{task" }] }]),
      "unknown-placeholder",
    ],
    [
      "a placeholder in a type — a type is never derived from the machine",
      fileOf([{ ...TASK_RULE, emit: [{ type: "{task}", key: "{task}" }] }]),
      "unknown-placeholder",
    ],
  ])("refuses %s", (_name, text, code) => {
    expect(invalidCode(text)).toBe(code);
  });

  it.each(["cwd", "session", "path", "environment", "prompt", ""])(
    "refuses a rule that reads %j — the branch and the declared source name are the only sources",
    (from) => {
      expect(invalidCode(fileOf([{ ...TASK_RULE, from }]))).toBe("unknown-source");
    },
  );

  it.each(["endpoint", "token", "project", "granularity", "privacy"])(
    "refuses a file with the top-level key %j rather than half-obeying it",
    (key) => {
      expect(invalidCode(fileOf([TASK_RULE], { [key]: "anything" }))).toBe("unknown-key");
    },
  );

  it("refuses an unknown key inside a rule", () => {
    expect(invalidCode(fileOf([{ ...TASK_RULE, hash: true }]))).toBe("unknown-key");
  });

  it("refuses an unknown key inside an emit entry, such as a weight or a confidence", () => {
    const emit = [{ type: "task", key: "{task}", weight: 1 }];
    expect(invalidCode(fileOf([{ ...TASK_RULE, emit }]))).toBe("unknown-key");
  });

  it("refuses a file larger than the limit", () => {
    const padding = " ".repeat(ATTRIBUTION_LIMITS.fileBytes);
    expect(invalidCode(`${fileOf([TASK_RULE])}${padding}`)).toBe("too-large");
  });

  it.each<[string, unknown]>([
    [
      "more rules than the limit",
      Array.from({ length: ATTRIBUTION_LIMITS.rules + 1 }, () => TASK_RULE),
    ],
    [
      "more emit entries than the limit",
      [
        {
          ...TASK_RULE,
          emit: Array.from({ length: ATTRIBUTION_LIMITS.emitsPerRule + 1 }, (_, index) => ({
            type: `t${index}`,
            key: "{task}",
          })),
        },
      ],
    ],
    [
      "a pattern longer than the limit",
      [{ ...TASK_RULE, match: `(?<task>${"a".repeat(ATTRIBUTION_LIMITS.patternLength)})` }],
    ],
    [
      "a type longer than the limit",
      [
        {
          ...TASK_RULE,
          emit: [{ type: "t".repeat(ATTRIBUTION_LIMITS.typeLength + 1), key: "{task}" }],
        },
      ],
    ],
    [
      "a key template longer than the limit",
      [
        {
          ...TASK_RULE,
          emit: [{ type: "task", key: "k".repeat(ATTRIBUTION_LIMITS.keyLength + 1) }],
        },
      ],
    ],
  ])("refuses %s", (_name, attribution) => {
    expect(invalidCode(fileOf(attribution))).toBe("limit-exceeded");
  });

  it("refuses a pattern whose group names cannot be read in time", () => {
    const neverAnswers: RuleMatcher = () => ({ kind: "timeout" });
    const parsed = parseAttributionRules(fileOf([TASK_RULE]), neverAnswers);
    expect(parsed).toEqual({ kind: "invalid", code: "invalid-pattern" });
  });
});

describe("buildAttributor: the branch", () => {
  it("emits the type the file wrote and a key built from the named capture", () => {
    const { attribute } = buildAttributor(rulesOf([TASK_RULE]));
    expect(attribute({ branch: "K123-add-export" })).toEqual([{ type: "task", key: "K123" }]);
  });

  it("joins literal text and several captures in one key", () => {
    const { attribute } = buildAttributor(
      rulesOf([
        {
          from: "branch",
          match: "^(?<task>[A-Z][0-9]{3})-(?<spec>[0-9]{4})-",
          emit: [
            { type: "task", key: "{task}" },
            { type: "spec", key: "specs/{spec}/{task}" },
          ],
        },
      ]),
    );
    expect(attribute({ branch: "K123-0042-add-export" })).toEqual([
      { type: "task", key: "K123" },
      { type: "spec", key: "specs/0042/K123" },
    ]);
  });

  it("emits a constant key when the template has no placeholder", () => {
    const { attribute } = buildAttributor(
      rulesOf([{ from: "branch", match: "^main$", emit: [{ type: "line", key: "mainline" }] }]),
    );
    expect(attribute({ branch: "main" })).toEqual([{ type: "line", key: "mainline" }]);
  });

  it("emits nothing for a branch no rule matches", () => {
    const { attribute } = buildAttributor(rulesOf([TASK_RULE]));
    expect(attribute({ branch: "main" })).toEqual([]);
  });

  it("emits nothing for a turn that records no branch", () => {
    const { attribute } = buildAttributor(rulesOf([TASK_RULE]));
    expect(attribute({})).toEqual([]);
  });

  it("lets only the first matching rule emit, so a specific rule shadows a general one", () => {
    const { attribute } = buildAttributor(
      rulesOf([
        TASK_RULE,
        { from: "branch", match: "^(?<all>.+)$", emit: [{ type: "branch", key: "{all}" }] },
      ]),
    );
    expect(attribute({ branch: "K123-add-export" })).toEqual([{ type: "task", key: "K123" }]);
    expect(attribute({ branch: "main" })).toEqual([{ type: "branch", key: "main" }]);
  });

  it("drops an entry whose group took no part in the match and keeps the rule's others", () => {
    const { attribute } = buildAttributor(
      rulesOf([
        {
          from: "branch",
          match: "^(?<task>[A-Z][0-9]{3})(?:-(?<spec>[0-9]{4}))?-",
          emit: [
            { type: "spec", key: "{spec}" },
            { type: "task", key: "{task}" },
          ],
        },
      ]),
    );
    expect(attribute({ branch: "K123-add-export" })).toEqual([{ type: "task", key: "K123" }]);
  });

  it("drops an entry whose key comes out empty", () => {
    const { attribute } = buildAttributor(
      rulesOf([{ from: "branch", match: "^(?<none>)", emit: [{ type: "task", key: "{none}" }] }]),
    );
    expect(attribute({ branch: "main" })).toEqual([]);
  });

  it("drops an entry whose key comes out longer than the limit", () => {
    const { attribute } = buildAttributor(
      rulesOf([
        { from: "branch", match: "^(?<all>.+)$", emit: [{ type: "branch", key: "{all}" }] },
      ]),
    );
    const justFits = "b".repeat(ATTRIBUTION_LIMITS.keyLength);
    expect(attribute({ branch: justFits })).toEqual([{ type: "branch", key: justFits }]);
    expect(attribute({ branch: `${justFits}b` })).toEqual([]);
  });

  it("sends an identical pair once", () => {
    const { attribute } = buildAttributor(
      rulesOf([
        {
          ...TASK_RULE,
          emit: [
            { type: "task", key: "{task}" },
            { type: "task", key: "{task}" },
          ],
        },
      ]),
    );
    expect(attribute({ branch: "K123-add-export" })).toEqual([{ type: "task", key: "K123" }]);
  });

  it("does not match a branch name longer than the limit", () => {
    const { attribute } = buildAttributor(
      rulesOf([{ from: "branch", match: "^(?<head>[a-z])", emit: [{ type: "t", key: "{head}" }] }]),
    );
    expect(attribute({ branch: "a".repeat(ATTRIBUTION_LIMITS.inputLength) })).toHaveLength(1);
    expect(attribute({ branch: "a".repeat(ATTRIBUTION_LIMITS.inputLength + 1) })).toEqual([]);
  });

  it("asks the matcher once per distinct branch, however many turns ran on it", () => {
    const asked: string[] = [];
    const counting: RuleMatcher = (pattern, text) => {
      asked.push(text);
      return guardedMatch(pattern, text);
    };
    const { attribute } = buildAttributor(rulesOf([TASK_RULE]), { matcher: counting });

    for (let index = 0; index < 5; index += 1) {
      attribute({ branch: "K123-add-export" });
      attribute({ branch: "main" });
    }

    expect(asked.sort()).toEqual(["K123-add-export", "main"]);
  });
});

describe("buildAttributor: the declared source name", () => {
  it("emits the source rule's dimensions for every turn, with or without a branch", () => {
    const { attribute } = buildAttributor(rulesOf([SOURCE_RULE]), { source: "laptop-a" });
    expect(attribute({ branch: "main" })).toEqual([{ type: "checkout", key: "laptop-a" }]);
    expect(attribute({})).toEqual([{ type: "checkout", key: "laptop-a" }]);
  });

  it("emits nothing from a source rule when no name was declared", () => {
    const { attribute } = buildAttributor(rulesOf([SOURCE_RULE]));
    expect(attribute({ branch: "main" })).toEqual([]);
  });

  it("emits nothing for a name the rule's pattern does not accept", () => {
    const allowlist = { ...SOURCE_RULE, match: "^(?<name>laptop-a|laptop-b)$" };
    const { attribute } = buildAttributor(rulesOf([allowlist]), { source: "laptop-c" });
    expect(attribute({})).toEqual([]);
  });

  it("never matches a branch rule against the name, nor a source rule against the branch", () => {
    const { attribute } = buildAttributor(rulesOf([TASK_RULE, SOURCE_RULE]), {
      source: "K999-not-a-branch",
    });
    expect(attribute({ branch: "laptop-a" })).toEqual([]);
  });

  it("lets the first matching rule of EACH source emit, in the order the rules were written", () => {
    const rules = rulesOf([
      SOURCE_RULE,
      TASK_RULE,
      { from: "source", match: "^(?<all>.+)$", emit: [{ type: "shadowed", key: "{all}" }] },
      { from: "branch", match: "^(?<all>.+)$", emit: [{ type: "shadowed", key: "{all}" }] },
    ]);
    const { attribute } = buildAttributor(rules, { source: "laptop-a" });

    expect(attribute({ branch: "K123-add-export" })).toEqual([
      { type: "checkout", key: "laptop-a" },
      { type: "task", key: "K123" },
    ]);
  });

  it("matches the name once per run, not once per turn", () => {
    const asked: string[] = [];
    const counting: RuleMatcher = (pattern, text) => {
      asked.push(text);
      return guardedMatch(pattern, text);
    };
    const { attribute } = buildAttributor(rulesOf([SOURCE_RULE]), {
      source: "laptop-a",
      matcher: counting,
    });

    attribute({ branch: "main" });
    attribute({ branch: "K123-add-export" });
    attribute({});

    expect(asked).toEqual(["laptop-a"]);
  });

  it("caps what one measurement carries", () => {
    const emit = (prefix: string) =>
      Array.from({ length: ATTRIBUTION_LIMITS.emitsPerRule }, (_, index) => ({
        type: `${prefix}${index}`,
        key: "{all}",
      }));
    const rules = rulesOf([
      { from: "branch", match: "^(?<all>.+)$", emit: emit("b") },
      { from: "source", match: "^(?<all>.+)$", emit: emit("s") },
    ]);
    const { attribute } = buildAttributor(rules, { source: "laptop-a" });

    expect(attribute({ branch: "main" })).toHaveLength(ATTRIBUTION_LIMITS.dimensionsPerMeasurement);
  });
});

describe("buildAttributor: a pattern that does not answer in time", () => {
  it("switches the rules off for the rest of the run and says so", () => {
    let calls = 0;
    const slowOnSecond: RuleMatcher = (pattern, text) => {
      calls += 1;
      return calls === 2 ? { kind: "timeout" } : guardedMatch(pattern, text);
    };
    const state = buildAttributor(rulesOf([TASK_RULE]), { matcher: slowOnSecond });

    expect(state.attribute({ branch: "K123-add-export" })).toEqual([{ type: "task", key: "K123" }]);
    expect(state.timedOut()).toBe(false);
    expect(state.attribute({ branch: "K124-next" })).toEqual([]);
    expect(state.timedOut()).toBe(true);
    // Off means off: not even a branch that matched a moment ago.
    expect(state.attribute({ branch: "K123-add-export" })).toEqual([]);
    expect(calls).toBe(2);
  });

  it("is off from the start when the name's own rule does not answer", () => {
    const state = buildAttributor(rulesOf([SOURCE_RULE, TASK_RULE]), {
      source: "laptop-a",
      matcher: () => ({ kind: "timeout" }),
    });

    expect(state.timedOut()).toBe(true);
    expect(state.attribute({ branch: "K123-add-export" })).toEqual([]);
  });
});

describe("guardedMatch", () => {
  it("returns the named groups of a match", () => {
    expect(guardedMatch(/^(?<task>[A-Z][0-9]{3})-/, "K123-add-export")).toEqual({
      kind: "match",
      groups: { task: "K123" },
    });
  });

  it("returns no groups for a pattern that names none", () => {
    expect(guardedMatch(/^main$/, "main")).toEqual({ kind: "match", groups: {} });
  });

  it("says when the text does not match", () => {
    expect(guardedMatch(/^main$/, "K123-add-export")).toEqual({ kind: "no-match" });
  });

  it("interrupts a pattern that backtracks without bound instead of holding the run", () => {
    // Deliberately no assertion on elapsed time: the property is that this returns at all.
    expect(guardedMatch(/^(a+)+$/, `${"a".repeat(64)}!`)).toEqual({ kind: "timeout" });
  });
});

describe("readRulesFile and loadAttributionRules", () => {
  it("says a repository without the file has none — that is not a failure", async () => {
    const root = await makeTempDir();
    expect(await readRulesFile(join(root, ATTRIBUTION_FILE))).toEqual({ kind: "absent" });
    expect(await loadAttributionRules(root)).toEqual({ kind: "none" });
  });

  it("loads the rules from the file at the repository's root", async () => {
    const root = await makeTempDir();
    await writeFile(join(root, ATTRIBUTION_FILE), fileOf([TASK_RULE]), "utf8");

    const loaded = await loadAttributionRules(root);

    expect(loaded.kind).toBe("rules");
    if (loaded.kind !== "rules") return;
    expect(buildAttributor(loaded.rules).attribute({ branch: "K123-add-export" })).toEqual([
      { type: "task", key: "K123" },
    ]);
  });

  it("reports an invalid file with the code of the check that failed, and nothing of its content", async () => {
    const root = await makeTempDir();
    await writeFile(join(root, ATTRIBUTION_FILE), fileOf([{ ...TASK_RULE, from: "cwd" }]), "utf8");

    expect(await loadAttributionRules(root)).toEqual({
      kind: "failed",
      reason: "invalid-rules",
      detail: "unknown-source",
    });
  });

  it("does not read a file larger than the limit", async () => {
    const root = await makeTempDir();
    const path = join(root, ATTRIBUTION_FILE);
    await writeFile(path, " ".repeat(ATTRIBUTION_LIMITS.fileBytes + 1), "utf8");

    expect(await readRulesFile(path)).toEqual({ kind: "too-large" });
    expect(await loadAttributionRules(root)).toEqual({
      kind: "failed",
      reason: "invalid-rules",
      detail: "too-large",
    });
  });

  it("reports something at that path that is not a file as unreadable", async () => {
    const root = await makeTempDir();
    await mkdir(join(root, ATTRIBUTION_FILE));

    expect(await loadAttributionRules(root)).toEqual({
      kind: "failed",
      reason: "unreadable-rules",
    });
  });

  it("reports a file that is there and cannot be read as unreadable", async () => {
    const loaded = await loadAttributionRules("/repository", async () => ({ kind: "unreadable" }));

    expect(loaded).toEqual({ kind: "failed", reason: "unreadable-rules" });
  });

  it("does not raise when reading raises where nothing is supposed to", async () => {
    const loaded = await loadAttributionRules("/repository", async () => {
      throw new Error("unexpected");
    });

    expect(loaded).toEqual({ kind: "failed", reason: "unreadable-rules" });
  });
});
