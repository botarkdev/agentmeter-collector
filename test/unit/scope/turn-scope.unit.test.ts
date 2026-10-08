import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  claudeProjectDirectoryName,
  isWithinDirectory,
  repositoryCacheDirectory,
  repositoryScope,
} from "../../../src/scope/turn-scope.js";

const TRANSCRIPTS = "/home/placeholder/.claude/projects";
const ROOT = "/work/acme/widgets";

describe("claudeProjectDirectoryName", () => {
  it("replaces every character that is not a letter or a digit with a hyphen", () => {
    expect(claudeProjectDirectoryName("/work/acme/widgets")).toBe("-work-acme-widgets");
    expect(claudeProjectDirectoryName("/work/acme/widgets/.worktrees/task_1")).toBe(
      "-work-acme-widgets--worktrees-task-1",
    );
  });
});

describe("isWithinDirectory", () => {
  it("accepts the root itself and anything below it", () => {
    expect(isWithinDirectory(ROOT, ROOT)).toBe(true);
    expect(isWithinDirectory(ROOT, `${ROOT}/apps/api`)).toBe(true);
    expect(isWithinDirectory(ROOT, `${ROOT}/.worktrees/task`)).toBe(true);
  });

  it("rejects a sibling whose name merely starts with the root's", () => {
    expect(isWithinDirectory(ROOT, `${ROOT}-collector`)).toBe(false);
    expect(isWithinDirectory(ROOT, `${ROOT}-collector/src`)).toBe(false);
  });

  it("rejects a parent and an unrelated directory", () => {
    expect(isWithinDirectory(ROOT, "/work/acme")).toBe(false);
    expect(isWithinDirectory(ROOT, "/elsewhere")).toBe(false);
  });

  it("is not fooled by a path that climbs back out", () => {
    expect(isWithinDirectory(ROOT, `${ROOT}/../gadgets`)).toBe(false);
  });
});

describe("repositoryScope", () => {
  const scope = repositoryScope(ROOT, TRANSCRIPTS);

  it("claims every transcript in the repository's own project directory", () => {
    expect(scope.acceptsTranscript(join(TRANSCRIPTS, "-work-acme-widgets", "s.jsonl"))).toBe(true);
    expect(
      scope.acceptsTranscript(
        join(TRANSCRIPTS, "-work-acme-widgets", "session-id", "subagents", "agent.jsonl"),
      ),
    ).toBe(true);
  });

  it("does not claim the project directory of a sibling that shares its prefix", () => {
    expect(
      scope.acceptsTranscript(join(TRANSCRIPTS, "-work-acme-widgets-collector", "s.jsonl")),
    ).toBe(false);
  });

  it("does not claim another repository's project directory, or a worktree's", () => {
    expect(scope.acceptsTranscript(join(TRANSCRIPTS, "-work-acme-gadgets", "s.jsonl"))).toBe(false);
    expect(
      scope.acceptsTranscript(join(TRANSCRIPTS, "-work-acme-widgets--worktrees-task", "s.jsonl")),
    ).toBe(false);
  });

  it("accepts a turn that ran inside the repository, wherever its transcript is kept", () => {
    expect(scope.acceptsWorkingDirectory(`${ROOT}/.worktrees/task`)).toBe(true);
    expect(scope.acceptsWorkingDirectory(ROOT)).toBe(true);
  });

  it("rejects a turn that ran elsewhere, and one that records no working directory", () => {
    expect(scope.acceptsWorkingDirectory("/work/acme/gadgets")).toBe(false);
    expect(scope.acceptsWorkingDirectory(undefined)).toBe(false);
  });
});

describe("repositoryCacheDirectory", () => {
  it("gives each repository a directory of its own under the cache directory", () => {
    const first = repositoryCacheDirectory("/cache/agentmeter", "/work/acme/widgets");
    const second = repositoryCacheDirectory("/cache/agentmeter", "/work/acme/gadgets");

    expect(first).not.toBe(second);
    expect(first.startsWith(join("/cache/agentmeter", "repositories"))).toBe(true);
  });

  it("is the same directory every time for the same repository", () => {
    expect(repositoryCacheDirectory("/cache/agentmeter", ROOT)).toBe(
      repositoryCacheDirectory("/cache/agentmeter", `${ROOT}/`),
    );
  });

  it("does not put the repository's path in the name", () => {
    const directory = repositoryCacheDirectory("/cache/agentmeter", "/work/acme/widgets");
    expect(directory).not.toContain("acme");
    expect(directory).not.toContain("widgets");
  });
});
