import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileBatchQueue, batchFileName } from "../../../src/queue/batch-queue.js";
import type { IngestBatch } from "../../../src/contract/ingest-contract.js";
import { makeTempDir } from "../support/transcripts.js";

function batch(key: string): IngestBatch {
  return {
    agent: "claude-code",
    measurements: [
      {
        idempotencyKey: key,
        occurredAt: "2026-08-20T10:00:00.000Z",
        model: "claude-opus-5",
        pricingTier: "standard",
        tokens: { input: 1, output: 1, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 },
      },
    ],
  };
}

async function queueIn(directory: string, now?: () => number) {
  return new FileBatchQueue(join(directory, "queue"), now);
}

describe("batchFileName", () => {
  it("sorts lexicographically in the order the batches were written", () => {
    const early = batchFileName(1_700_000_000_000, 0, "aaaaaaaa");
    const later = batchFileName(1_700_000_000_001, 0, "aaaaaaaa");
    expect([later, early].sort()).toEqual([early, later]);
  });

  it("keeps time ordering even when one timestamp has fewer digits", () => {
    const short = batchFileName(999, 0, "zzzzzzzz");
    const long = batchFileName(1_700_000_000_000, 0, "aaaaaaaa");
    expect([long, short].sort()).toEqual([short, long]);
  });

  it("orders batches written within the SAME millisecond, whatever the random suffix", () => {
    // Without the sequence, ordering inside one run is decided by Math.random — which is to say
    // not decided. The suffixes here are chosen to sort the wrong way round if it were.
    const first = batchFileName(1_700_000_000_000, 0, "zzzzzzzz");
    const second = batchFileName(1_700_000_000_000, 1, "aaaaaaaa");
    expect([second, first].sort()).toEqual([first, second]);
  });

  it("keeps sequence ordering as the count grows a digit", () => {
    const ninth = batchFileName(1_700_000_000_000, 9, "aaaaaaaa");
    const tenth = batchFileName(1_700_000_000_000, 10, "aaaaaaaa");
    expect([tenth, ninth].sort()).toEqual([ninth, tenth]);
  });
});

describe("FileBatchQueue", () => {
  it("writes one file per batch and lists them oldest first", async () => {
    const directory = await makeTempDir();
    let clock = 1000;
    const queue = await queueIn(directory, () => (clock += 1));

    const result = await queue.enqueue([batch("a"), batch("b"), batch("c")], 100);
    expect(result).toEqual({ enqueued: 3, discarded: 0, failed: false });

    const names = await queue.list();
    expect(names).toHaveLength(3);
    expect([...names]).toEqual([...names].sort());

    const first = await queue.read(names[0]!);
    expect(first.kind === "batch" && first.batch.measurements[0]?.idempotencyKey).toBe("a");
  });

  it("does nothing when there is nothing to enqueue", async () => {
    const directory = await makeTempDir();
    const queue = await queueIn(directory);
    expect(await queue.enqueue([], 100)).toEqual({ enqueued: 0, discarded: 0, failed: false });
    expect(await queue.list()).toEqual([]);
  });

  it("lists nothing when the queue directory has never been created", async () => {
    const directory = await makeTempDir();
    const queue = await queueIn(directory);
    expect(await queue.list()).toEqual([]);
  });

  it("never lists a partially written file", async () => {
    const directory = await makeTempDir();
    const queue = await queueIn(directory);
    await queue.enqueue([batch("a")], 100);

    // A half-written batch, as a crashed run would leave it.
    await writeFile(
      join(directory, "queue", "00000000000999-crashed.json.tmp"),
      '{"agent"',
      "utf8",
    );

    const names = await queue.list();
    expect(names).toHaveLength(1);
    expect(names[0]?.endsWith(".tmp")).toBe(false);
  });

  it("batches written in the SAME millisecond all survive AND stay in order", async () => {
    // A frozen clock is the real case made deterministic: a run enqueues far faster than the
    // clock ticks, so every batch of a run shares one millisecond. Both halves matter — that
    // none is lost to a name collision, and that "oldest first" still means something.
    const directory = await makeTempDir();
    const queue = await queueIn(directory, () => 1_700_000_000_000);
    await queue.enqueue([batch("a"), batch("b"), batch("c")], 100);

    const names = await queue.list();
    expect(names).toHaveLength(3);

    const keys = await Promise.all(
      names.map(async (name) => {
        const read = await queue.read(name);
        return read.kind === "batch" ? read.batch.measurements[0]?.idempotencyKey : undefined;
      }),
    );
    expect(keys).toEqual(["a", "b", "c"]);
  });

  it("removes a delivered batch", async () => {
    const directory = await makeTempDir();
    const queue = await queueIn(directory);
    await queue.enqueue([batch("a")], 100);
    const [name] = await queue.list();
    await queue.remove(name!);
    expect(await queue.list()).toEqual([]);
  });

  it("removing something already gone is not an error — another run may have delivered it", async () => {
    const directory = await makeTempDir();
    const queue = await queueIn(directory);
    await expect(queue.remove("00000000000001-nothing.json")).resolves.toBeUndefined();
  });

  it.each([
    ["not valid JSON", "{ broken"],
    ["JSON that is not a batch", '{"hello":"world"}'],
    ["a batch with no measurements", '{"agent":"claude-code","measurements":[]}'],
    ["a batch with no agent", '{"measurements":[{}]}'],
  ])("reports a queue file containing %s as unreadable", async (_label, contents) => {
    const directory = await makeTempDir();
    const queue = await queueIn(directory);
    await queue.enqueue([batch("a")], 100);
    await writeFile(join(directory, "queue", "00000000000001-broken.json"), contents, "utf8");

    const read = await queue.read("00000000000001-broken.json");
    expect(read).toEqual({ kind: "unreadable" });
  });

  it("reports a file that has vanished as unreadable rather than throwing", async () => {
    const directory = await makeTempDir();
    const queue = await queueIn(directory);
    await queue.enqueue([batch("a")], 100);
    expect(await queue.read("00000000000001-gone.json")).toEqual({ kind: "unreadable" });
  });

  it("holds the ceiling by discarding the OLDEST batches", async () => {
    const directory = await makeTempDir();
    let clock = 1_700_000_000_000;
    const queue = await queueIn(directory, () => (clock += 1));

    await queue.enqueue([batch("oldest-1"), batch("oldest-2")], 10);
    const result = await queue.enqueue([batch("new-1"), batch("new-2"), batch("new-3")], 3);

    expect(result.discarded).toBe(2);
    const names = await queue.list();
    expect(names).toHaveLength(3);

    const keys = await Promise.all(
      names.map(async (name) => {
        const read = await queue.read(name);
        return read.kind === "batch" ? read.batch.measurements[0]?.idempotencyKey : undefined;
      }),
    );
    // The newest survive; the two oldest are the ones that went.
    expect(keys).toEqual(["new-1", "new-2", "new-3"]);
  });

  it("reports a failure rather than throwing when the queue directory cannot be created", async () => {
    const directory = await makeTempDir();
    // A regular file where the queue directory needs to be: mkdir cannot succeed.
    await writeFile(join(directory, "queue"), "in the way", "utf8");
    const queue = await queueIn(directory);

    const result = await queue.enqueue([batch("a")], 100);
    expect(result).toEqual({ enqueued: 0, discarded: 0, failed: true });
  });

  it("writes exactly the request body and nothing around it", async () => {
    // A queue file is delivered under whatever configuration the NEXT run resolves, which is what
    // makes rotating a token or moving an endpoint recover the backlog rather than strand it — so
    // neither may be baked into the file. FR-027's credential assertion lives in
    // run-collector.unit.test.ts, where a token is actually configured and can therefore leak.
    const directory = await makeTempDir();
    const queue = await queueIn(directory);
    await queue.enqueue([batch("a")], 100);

    const queueDir = join(directory, "queue");
    const [name] = await readdir(queueDir);
    const written: unknown = JSON.parse(await readFile(join(queueDir, name!), "utf8"));
    expect(Object.keys(written as object).sort()).toEqual(["agent", "measurements"]);
  });
});
