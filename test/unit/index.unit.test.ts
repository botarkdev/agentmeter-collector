import { describe, expect, it } from "vitest";
import { packageName } from "../../src/index.js";

describe("packages/collector scaffolding", () => {
  it("is wired end-to-end: importable, typed, and testable", () => {
    expect(packageName).toBe("@agentmeter/collector");
  });
});
