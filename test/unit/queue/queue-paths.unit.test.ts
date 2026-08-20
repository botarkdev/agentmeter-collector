import { describe, expect, it } from "vitest";
import { cursorPath, queueDirectory } from "../../../src/queue/queue-paths.js";

describe("queue paths", () => {
  it("keeps both of the collector's files under one directory a developer can delete", () => {
    const cacheDir = "/cache/agentmeter";
    expect(queueDirectory(cacheDir)).toBe("/cache/agentmeter/queue");
    expect(cursorPath(cacheDir)).toBe("/cache/agentmeter/scan-cursor.json");
  });
});
