import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ATTRIBUTION_FILE, guardedMatch } from "../../../src/attribution/attribution-rules.js";
import { summarise } from "../../../src/cli/run-cli.js";
import { resolveConfigFromEnv, type ResolvedConfig } from "../../../src/config/collector-config.js";
import type { IngestBatch } from "../../../src/contract/ingest-contract.js";
import { readCursor } from "../../../src/cursor/scan-cursor.js";
import { FileBatchQueue, type BatchQueue } from "../../../src/queue/batch-queue.js";
import { cursorPath, queueDirectory } from "../../../src/queue/queue-paths.js";
import { runCollector, type RunDependencies } from "../../../src/run/run-collector.js";
import type { DeliveryOutcome, IngestTransport } from "../../../src/transport/ingest-transport.js";
import { assistantTurn, makeTempDir, writeTranscript } from "../support/transcripts.js";

const TOKEN = "amk_live_placeholder_token_that_must_not_leak";

interface Harness {
  readonly resolved: ResolvedConfig;
  readonly cacheDir: string;
  readonly transcriptsDir: string;
}

async function harness(env: Record<string, string> = {}): Promise<Harness> {
  const root = await makeTempDir();
  const transcriptsDir = join(root, "transcripts");
  const cacheDir = join(root, "cache");
  const resolved = resolveConfigFromEnv(
    {
      // A reserved TLD (RFC 2606) — a placeholder, never a real host.
      AGENTMETER_ENDPOINT: "https://collector.invalid",
      AGENTMETER_TOKEN: TOKEN,
      AGENTMETER_TRANSCRIPTS_DIR: transcriptsDir,
      AGENTMETER_CACHE_DIR: cacheDir,
      // Every suite below but the last is about scanning, retaining and delivering, and says so
      // against the whole transcripts directory. The scope has a suite of its own.
      AGENTMETER_SCOPE: "machine",
      ...env,
    },
    "/home/placeholder",
  );
  return { resolved, cacheDir, transcriptsDir };
}

/** A transport that answers however a test says, and records what it was handed. */
function transportOf(
  answer: (batch: IngestBatch, call: number) => DeliveryOutcome,
): IngestTransport & { readonly delivered: IngestBatch[] } {
  const delivered: IngestBatch[] = [];
  return {
    delivered,
    deliver: async (batch) => {
      delivered.push(batch);
      return answer(batch, delivered.length);
    },
  };
}

const ACCEPT_ALL = (batch: IngestBatch): DeliveryOutcome => ({
  kind: "accepted",
  accepted: batch.measurements.length,
  deduplicated: 0,
  rejected: 0,
});

const DEDUPLICATE_ALL = (batch: IngestBatch): DeliveryOutcome => ({
  kind: "accepted",
  accepted: 0,
  deduplicated: batch.measurements.length,
  rejected: 0,
});

const UNREACHABLE: DeliveryOutcome = {
  kind: "retain",
  reason: "unreachable",
  stopDraining: true,
};

async function overridesFor(
  h: Harness,
  transport: IngestTransport,
  extra: Partial<RunDependencies> = {},
): Promise<Partial<RunDependencies>> {
  if (h.resolved.status !== "configured") {
    throw new Error("harness must be configured");
  }
  return {
    transport,
    queue: new FileBatchQueue(queueDirectory(h.cacheDir)),
    ...extra,
  };
}

describe("runCollector: the happy path", () => {
  it("sends one measurement per assistant turn and leaves nothing queued", async () => {
    const h = await harness();
    await writeTranscript(join(h.transcriptsDir, "-project"), "s.jsonl", [
      assistantTurn({ messageId: "msg_a" }),
      assistantTurn({ messageId: "msg_b" }),
      { type: "user", message: { content: "irrelevant" } },
    ]);
    const transport = transportOf(ACCEPT_ALL);

    const outcome = await runCollector(h.resolved, await overridesFor(h, transport));

    expect(outcome.status).toBe("collected");
    expect(outcome.scan.measurements).toBe(2);
    expect(outcome.delivery.accepted).toBe(2);
    expect(outcome.queue.remaining).toBe(0);
    expect(transport.delivered[0]?.agent).toBe("claude-code");
  });

  it("splits into batches that respect the configured size", async () => {
    const h = await harness({ AGENTMETER_MAX_BATCH_SIZE: "2" });
    await writeTranscript(
      join(h.transcriptsDir, "-project"),
      "s.jsonl",
      Array.from({ length: 5 }, (_, index) => assistantTurn({ messageId: `msg_${index}` })),
    );
    const transport = transportOf(ACCEPT_ALL);

    const outcome = await runCollector(h.resolved, await overridesFor(h, transport));

    expect(outcome.delivery.batchesSent).toBe(3);
    expect(transport.delivered.map((batch) => batch.measurements.length)).toEqual([2, 2, 1]);
  });

  it("a second run over unchanged transcripts changes nothing", async () => {
    const h = await harness();
    await writeTranscript(join(h.transcriptsDir, "-project"), "s.jsonl", [
      assistantTurn({ messageId: "msg_a" }),
    ]);

    const first = transportOf(ACCEPT_ALL);
    await runCollector(h.resolved, await overridesFor(h, first));

    const second = transportOf(DEDUPLICATE_ALL);
    const outcome = await runCollector(h.resolved, await overridesFor(h, second));

    // The cursor makes the second run do no work at all; even without it, the service would
    // deduplicate. Both are correct; what must never happen is a second charge.
    expect(outcome.delivery.accepted).toBe(0);
    expect(second.delivered).toEqual([]);
  });

  it("resends and is deduplicated when its local state is thrown away", async () => {
    // FR-023: local state is an optimisation. Deleting it changes how much is re-read, never
    // which measurements exist.
    const h = await harness();
    await writeTranscript(join(h.transcriptsDir, "-project"), "s.jsonl", [
      assistantTurn({ messageId: "msg_a" }),
    ]);

    await runCollector(h.resolved, await overridesFor(h, transportOf(ACCEPT_ALL)));
    await writeFile(cursorPath(h.cacheDir), "{ corrupt", "utf8");

    const second = transportOf(DEDUPLICATE_ALL);
    const outcome = await runCollector(h.resolved, await overridesFor(h, second));

    expect(second.delivered).toHaveLength(1);
    expect(outcome.delivery.deduplicated).toBe(1);
    expect(outcome.delivery.accepted).toBe(0);
    expect(outcome.queue.remaining).toBe(0);
  });

  it("reports a run with no transcripts as a successful nothing", async () => {
    const h = await harness();
    const outcome = await runCollector(h.resolved, await overridesFor(h, transportOf(ACCEPT_ALL)));

    expect(outcome.status).toBe("collected");
    expect(outcome.scan.measurements).toBe(0);
    expect(outcome.delivery.batchesSent).toBe(0);
    expect(outcome.failures).toEqual([]);
  });
});

describe("runCollector: never blocks, never fails", () => {
  it("returns an outcome rather than raising when nothing is configured", async () => {
    const outcome = await runCollector(resolveConfigFromEnv({}, "/home/placeholder"));
    expect(outcome.status).toBe("not-configured");
    expect(outcome.scan.measurements).toBe(0);
  });

  it.each<[string, DeliveryOutcome]>([
    ["the service is unreachable", UNREACHABLE],
    ["the request times out", { kind: "retain", reason: "timeout", stopDraining: true }],
    ["the service errors", { kind: "retain", reason: "server-error", stopDraining: false }],
    [
      "the token is rejected",
      { kind: "retain", reason: "reauthentication-required", stopDraining: true },
    ],
    ["the service rate-limits", { kind: "retain", reason: "rate-limited", stopDraining: true }],
    [
      "the answer is unrecognisable",
      { kind: "retain", reason: "unrecognised-response", stopDraining: false },
    ],
  ])("resolves with an outcome and retains the work when %s", async (_label, answer) => {
    const h = await harness();
    await writeTranscript(join(h.transcriptsDir, "-project"), "s.jsonl", [
      assistantTurn({ messageId: "msg_a" }),
    ]);

    const outcome = await runCollector(
      h.resolved,
      await overridesFor(
        h,
        transportOf(() => answer),
      ),
    );

    expect(outcome.status).toBe("collected");
    expect(outcome.queue.remaining).toBe(1);
    expect(outcome.delivery.accepted).toBe(0);
  });

  it("stops draining once the service says every further attempt will fail the same way", async () => {
    const h = await harness({ AGENTMETER_MAX_BATCH_SIZE: "1" });
    await writeTranscript(join(h.transcriptsDir, "-project"), "s.jsonl", [
      assistantTurn({ messageId: "msg_a" }),
      assistantTurn({ messageId: "msg_b" }),
      assistantTurn({ messageId: "msg_c" }),
    ]);

    const transport = transportOf(() => UNREACHABLE);
    const outcome = await runCollector(h.resolved, await overridesFor(h, transport));

    // One attempt, not three. The invariant is "it stopped", not any particular timing.
    expect(transport.delivered).toHaveLength(1);
    expect(outcome.queue.remaining).toBe(3);
  });

  it("keeps trying the remaining batches when a failure is only about one of them", async () => {
    const h = await harness({ AGENTMETER_MAX_BATCH_SIZE: "1" });
    await writeTranscript(join(h.transcriptsDir, "-project"), "s.jsonl", [
      assistantTurn({ messageId: "msg_a" }),
      assistantTurn({ messageId: "msg_b" }),
    ]);

    const transport = transportOf((batch, call) =>
      call === 1
        ? { kind: "retain", reason: "server-error", stopDraining: false }
        : ACCEPT_ALL(batch),
    );
    const outcome = await runCollector(h.resolved, await overridesFor(h, transport));

    expect(transport.delivered).toHaveLength(2);
    expect(outcome.delivery.accepted).toBe(1);
    expect(outcome.queue.remaining).toBe(1);
  });

  it("does not raise when the transcripts directory does not exist", async () => {
    const h = await harness({ AGENTMETER_TRANSCRIPTS_DIR: "/definitely/not/a/directory" });
    const outcome = await runCollector(h.resolved, await overridesFor(h, transportOf(ACCEPT_ALL)));
    expect(outcome.status).toBe("collected");
  });

  it("does not raise when the queue cannot be written, and reports it", async () => {
    const h = await harness();
    await writeTranscript(join(h.transcriptsDir, "-project"), "s.jsonl", [
      assistantTurn({ messageId: "msg_a" }),
    ]);
    // A regular file where the queue directory needs to be.
    await writeFile(h.cacheDir, "in the way", "utf8");

    const outcome = await runCollector(h.resolved, await overridesFor(h, transportOf(ACCEPT_ALL)));

    expect(outcome.status).toBe("collected");
    expect(outcome.failures).toContainEqual({
      stage: "queue",
      reason: "unwritable-queue",
      count: 1,
    });
  });

  it("does not raise when a dependency throws where nothing is supposed to throw", async () => {
    const h = await harness();
    const exploding: BatchQueue = {
      enqueue: async () => {
        throw new Error("disk on fire");
      },
      list: async () => [],
      read: async () => ({ kind: "unreadable" }),
      remove: async () => undefined,
    };
    await writeTranscript(join(h.transcriptsDir, "-project"), "s.jsonl", [
      assistantTurn({ messageId: "msg_a" }),
    ]);

    const outcome = await runCollector(h.resolved, {
      transport: transportOf(ACCEPT_ALL),
      queue: exploding,
    });

    expect(outcome.status).toBe("collected");
    expect(outcome.failures.length).toBeGreaterThan(0);
  });

  it("stops when the run budget is spent, and says so", async () => {
    const h = await harness({ AGENTMETER_MAX_BATCH_SIZE: "1", AGENTMETER_RUN_BUDGET_MS: "100" });
    await writeTranscript(join(h.transcriptsDir, "-project"), "s.jsonl", [
      assistantTurn({ messageId: "msg_a" }),
      assistantTurn({ messageId: "msg_b" }),
    ]);

    // An injected clock, not a real one: this asserts the budget is honoured without asserting
    // anything about how fast the machine running the test happens to be.
    let clock = 0;
    const transport = transportOf(ACCEPT_ALL);
    const outcome = await runCollector(h.resolved, {
      ...(await overridesFor(h, transport)),
      now: () => {
        const value = clock;
        clock += 60;
        return value;
      },
    });

    expect(outcome.budgetExhausted).toBe(true);
    expect(outcome.queue.remaining).toBeGreaterThan(0);
  });
});

describe("runCollector: what it does with retained work", () => {
  it("delivers a previous run's retained batches on the next run, oldest first", async () => {
    const h = await harness({ AGENTMETER_MAX_BATCH_SIZE: "1" });
    await writeTranscript(join(h.transcriptsDir, "-project"), "a.jsonl", [
      assistantTurn({ messageId: "msg_1" }),
      assistantTurn({ messageId: "msg_2" }),
      assistantTurn({ messageId: "msg_3" }),
    ]);

    const failing = transportOf(() => ({
      kind: "retain",
      reason: "server-error",
      stopDraining: false,
    }));
    const first = await runCollector(h.resolved, await overridesFor(h, failing));
    expect(first.queue.remaining).toBe(3);

    const succeeding = transportOf(ACCEPT_ALL);
    const second = await runCollector(h.resolved, await overridesFor(h, succeeding));

    expect(second.delivery.accepted).toBe(3);
    expect(second.queue.remaining).toBe(0);
    expect(succeeding.delivered.map((batch) => batch.measurements[0]?.idempotencyKey)).toEqual([
      "msg_1",
      "msg_2",
      "msg_3",
    ]);
  });

  it("discards a batch the service declares permanently invalid rather than retrying forever", async () => {
    const h = await harness();
    await writeTranscript(join(h.transcriptsDir, "-project"), "s.jsonl", [
      assistantTurn({ messageId: "msg_a" }),
    ]);

    const outcome = await runCollector(
      h.resolved,
      await overridesFor(
        h,
        transportOf(() => ({
          kind: "discard",
          reason: "rejected-permanently",
          detail: "VALIDATION_FAILED",
        })),
      ),
    );

    expect(outcome.queue.remaining).toBe(0);
    expect(outcome.queue.discarded).toBe(1);
    expect(outcome.failures).toContainEqual({
      stage: "transport",
      reason: "rejected-permanently",
      count: 1,
      detail: "VALIDATION_FAILED",
    });
  });

  it("removes an unreadable queue file instead of letting it block everything behind it", async () => {
    const h = await harness({ AGENTMETER_MAX_BATCH_SIZE: "1" });
    await writeTranscript(join(h.transcriptsDir, "-project"), "s.jsonl", [
      assistantTurn({ messageId: "msg_a" }),
    ]);
    await runCollector(
      h.resolved,
      await overridesFor(
        h,
        transportOf(() => UNREACHABLE),
      ),
    );

    // Corrupt the queued batch, as a torn disk write would.
    const queueDir = queueDirectory(h.cacheDir);
    const [name] = await readdir(queueDir);
    await writeFile(join(queueDir, name!), "{ not a batch", "utf8");

    const outcome = await runCollector(h.resolved, await overridesFor(h, transportOf(ACCEPT_ALL)));

    expect(outcome.queue.remaining).toBe(0);
    expect(outcome.failures).toContainEqual({
      stage: "queue",
      reason: "queue-item-unreadable",
      count: 1,
    });
  });

  it("holds the retention ceiling, discarding the oldest", async () => {
    const h = await harness({
      AGENTMETER_MAX_BATCH_SIZE: "1",
      AGENTMETER_MAX_QUEUED_BATCHES: "2",
    });
    await writeTranscript(
      join(h.transcriptsDir, "-project"),
      "s.jsonl",
      Array.from({ length: 5 }, (_, index) => assistantTurn({ messageId: `msg_${index}` })),
    );

    const outcome = await runCollector(
      h.resolved,
      await overridesFor(
        h,
        transportOf(() => UNREACHABLE),
      ),
    );

    expect(outcome.queue.remaining).toBe(2);
    expect(outcome.queue.discarded).toBe(3);
  });

  it("advances its local state only after the work is safely on disk", async () => {
    const h = await harness();
    await writeTranscript(join(h.transcriptsDir, "-project"), "s.jsonl", [
      assistantTurn({ messageId: "msg_a" }),
    ]);

    // The queue accepts nothing, so nothing was written down and the cursor must not claim the
    // lines were read.
    const refusing: BatchQueue = {
      enqueue: async () => ({ enqueued: 0, discarded: 0, failed: true }),
      list: async () => [],
      read: async () => ({ kind: "unreadable" }),
      remove: async () => undefined,
    };

    await runCollector(h.resolved, { transport: transportOf(ACCEPT_ALL), queue: refusing });
    expect((await readCursor(cursorPath(h.cacheDir))).files).toEqual({});

    // With a working queue, the same transcript is collected — nothing was lost by the failure.
    const transport = transportOf(ACCEPT_ALL);
    const outcome = await runCollector(h.resolved, await overridesFor(h, transport));
    expect(outcome.delivery.accepted).toBe(1);
  });
});

describe("runCollector: what it writes to disk", () => {
  it("never writes the ingest token anywhere under its cache directory (FR-027)", async () => {
    const h = await harness();
    await writeTranscript(join(h.transcriptsDir, "-project"), "s.jsonl", [
      assistantTurn({ messageId: "msg_a" }),
      assistantTurn({ messageId: "msg_b" }),
    ]);

    // Retained, not delivered — so everything this run produced is still on disk to inspect.
    const outcome = await runCollector(
      h.resolved,
      await overridesFor(
        h,
        transportOf(() => UNREACHABLE),
      ),
    );
    expect(outcome.queue.remaining).toBeGreaterThan(0);

    for (const name of await readdir(queueDirectory(h.cacheDir))) {
      expect(await readFile(join(queueDirectory(h.cacheDir), name), "utf8")).not.toContain(TOKEN);
    }
    expect(await readFile(cursorPath(h.cacheDir), "utf8")).not.toContain(TOKEN);
  });

  it("never writes anything derived from message content into a queued batch", async () => {
    const h = await harness();
    const secret = "MARKER_SOURCE_CODE_AND_SECRETS";
    const event = assistantTurn({ messageId: "msg_a" });
    event.cwd = `/work/${secret}`;
    event.gitBranch = secret;
    (event.message as Record<string, unknown>).content = [{ type: "text", text: secret }];

    await writeTranscript(join(h.transcriptsDir, "-project"), "s.jsonl", [event]);
    await runCollector(
      h.resolved,
      await overridesFor(
        h,
        transportOf(() => UNREACHABLE),
      ),
    );

    for (const name of await readdir(queueDirectory(h.cacheDir))) {
      expect(await readFile(join(queueDirectory(h.cacheDir), name), "utf8")).not.toContain(secret);
    }
  });

  it("reads the transcripts without modifying them", async () => {
    const h = await harness();
    const path = await writeTranscript(join(h.transcriptsDir, "-project"), "s.jsonl", [
      assistantTurn({ messageId: "msg_a" }),
    ]);
    const before = await readFile(path, "utf8");

    await runCollector(h.resolved, await overridesFor(h, transportOf(ACCEPT_ALL)));

    expect(await readFile(path, "utf8")).toBe(before);
  });
});

describe("runCollector: default wiring", () => {
  it("builds a real transport and queue when none is injected", async () => {
    // Exercises defaultDependencies without reaching the network: the endpoint is a reserved TLD,
    // so the request fails and the batch is retained, which is the documented behaviour.
    const h = await harness();
    await writeTranscript(join(h.transcriptsDir, "-project"), "s.jsonl", [
      assistantTurn({ messageId: "msg_a" }),
    ]);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network"));

    const outcome = await runCollector(h.resolved);

    expect(outcome.status).toBe("collected");
    expect(outcome.queue.remaining).toBe(1);
    fetchSpy.mockRestore();
  });
});
describe("runCollector: scoped to a repository", () => {
  const ROOT = "/work/acme/widgets";
  const OTHER_ROOT = "/work/acme/gadgets";
  const inRoot = (root: string) => ({ repositoryRoot: async () => root });

  /** Two repositories' sessions on one machine, plus a session opened in a worktree of the first. */
  async function twoRepositories(h: Harness): Promise<void> {
    await writeTranscript(join(h.transcriptsDir, "-work-acme-widgets"), "s.jsonl", [
      assistantTurn({ messageId: "msg_widgets", cwd: ROOT }),
    ]);
    await writeTranscript(join(h.transcriptsDir, "-work-acme-widgets--worktrees-task"), "s.jsonl", [
      assistantTurn({ messageId: "msg_widgets_worktree", cwd: `${ROOT}/.worktrees/task` }),
    ]);
    await writeTranscript(join(h.transcriptsDir, "-work-acme-gadgets"), "s.jsonl", [
      assistantTurn({ messageId: "msg_gadgets", cwd: OTHER_ROOT }),
    ]);
  }

  it("sends the repository's own sessions and its worktrees', and nobody else's", async () => {
    const h = await harness({ AGENTMETER_SCOPE: "repository" });
    await twoRepositories(h);
    const transport = transportOf(ACCEPT_ALL);

    const outcome = await runCollector(h.resolved, { transport }, inRoot(ROOT));

    const sent = transport.delivered.flatMap((batch) => batch.measurements);
    expect(sent.map((entry) => entry.idempotencyKey).sort()).toEqual([
      "msg_widgets",
      "msg_widgets_worktree",
    ]);
    expect(outcome.scan.turnsOutOfScope).toBe(1);
  });

  it("still sends nothing but the declared fields — the working directory selects, and stays", async () => {
    const h = await harness({ AGENTMETER_SCOPE: "repository" });
    await twoRepositories(h);
    const transport = transportOf(ACCEPT_ALL);

    await runCollector(h.resolved, { transport }, inRoot(ROOT));

    const serialised = JSON.stringify(transport.delivered);
    expect(serialised).not.toContain("acme");
    expect(serialised).not.toContain("widgets/");
    expect(serialised).not.toContain("worktrees");
  });

  it("lets the other repository find its own turns afterwards", async () => {
    // The first run reads the other repository's transcript and keeps nothing from it. If the two
    // shared a cursor, that transcript would now be marked as read and never reported.
    const h = await harness({ AGENTMETER_SCOPE: "repository" });
    await twoRepositories(h);
    await runCollector(h.resolved, { transport: transportOf(ACCEPT_ALL) }, inRoot(ROOT));
    const transport = transportOf(ACCEPT_ALL);

    await runCollector(h.resolved, { transport }, inRoot(OTHER_ROOT));

    const sent = transport.delivered.flatMap((batch) => batch.measurements);
    expect(sent.map((entry) => entry.idempotencyKey)).toEqual(["msg_gadgets"]);
  });

  it("never delivers one repository's retained batch on another repository's run", async () => {
    // A queued batch holds no token. Shared, it would be drained by whichever repository ran
    // next, under that repository's token, into that repository's project.
    const h = await harness({ AGENTMETER_SCOPE: "repository" });
    await twoRepositories(h);
    const retained = await runCollector(
      h.resolved,
      { transport: transportOf(() => UNREACHABLE) },
      inRoot(ROOT),
    );
    expect(retained.queue.remaining).toBe(1);
    const transport = transportOf(ACCEPT_ALL);

    await runCollector(h.resolved, { transport }, inRoot(OTHER_ROOT));

    const sent = transport.delivered.flatMap((batch) => batch.measurements);
    expect(sent.map((entry) => entry.idempotencyKey)).toEqual(["msg_gadgets"]);
  });

  it("delivers its own retained batch on its own next run", async () => {
    const h = await harness({ AGENTMETER_SCOPE: "repository" });
    await twoRepositories(h);
    await runCollector(h.resolved, { transport: transportOf(() => UNREACHABLE) }, inRoot(ROOT));
    const transport = transportOf(ACCEPT_ALL);

    const outcome = await runCollector(h.resolved, { transport }, inRoot(ROOT));

    expect(transport.delivered.flatMap((batch) => batch.measurements)).toHaveLength(2);
    expect(outcome.queue.remaining).toBe(0);
  });

  it("sends nothing, and does not raise, when the repository cannot be named", async () => {
    const h = await harness({ AGENTMETER_SCOPE: "repository" });
    await twoRepositories(h);
    const transport = transportOf(ACCEPT_ALL);

    const outcome = await runCollector(
      h.resolved,
      { transport },
      {
        repositoryRoot: async () => {
          throw new Error("no repository here");
        },
      },
    );

    expect(outcome.status).toBe("collected");
    expect(transport.delivered).toEqual([]);
    expect(outcome.failures).toEqual([{ stage: "scan", reason: "unreadable-file", count: 1 }]);
  });

  it("finds the repository it was started in when nothing is injected", async () => {
    // The default wiring: the root is looked up from the working directory of this test run,
    // which is not where the fixture's turns ran, so every one of them is out of scope.
    const h = await harness({ AGENTMETER_SCOPE: "repository" });
    await twoRepositories(h);
    const transport = transportOf(ACCEPT_ALL);

    const outcome = await runCollector(h.resolved, { transport });

    expect(transport.delivered).toEqual([]);
    expect(outcome.scan.turnsOutOfScope).toBe(3);
  });

  it("reports every repository when the scope is the machine", async () => {
    const h = await harness({ AGENTMETER_SCOPE: "machine" });
    await twoRepositories(h);
    const transport = transportOf(ACCEPT_ALL);

    const outcome = await runCollector(h.resolved, { transport });

    expect(transport.delivered.flatMap((batch) => batch.measurements)).toHaveLength(3);
    expect(outcome.scan.turnsOutOfScope).toBe(0);
  });
});

describe("runCollector: attribution rules a repository declares", () => {
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

  interface Repository extends Harness {
    readonly root: string;
    readonly scope: { repositoryRoot: () => Promise<string> };
  }

  /** A repository in a temporary directory, with a session on a task branch, one on `main`, and
   * a turn that records no branch. `rules` is written to its `.agentmeter.json` when given. */
  async function repository(
    rules: unknown,
    env: Record<string, string> = {},
    file?: string,
  ): Promise<Repository> {
    const h = await harness({ AGENTMETER_SCOPE: "repository", ...env });
    const root = join(await makeTempDir(), "widgets");
    await mkdir(root, { recursive: true });
    if (file !== undefined) {
      await writeFile(join(root, ATTRIBUTION_FILE), file, "utf8");
    } else if (rules !== undefined) {
      const text = JSON.stringify({ version: 1, attribution: rules });
      await writeFile(join(root, ATTRIBUTION_FILE), text, "utf8");
    }
    await writeTranscript(join(h.transcriptsDir, "sessions"), "s.jsonl", [
      assistantTurn({ messageId: "msg_task", cwd: root, gitBranch: "K123-add-export" }),
      assistantTurn({ messageId: "msg_main", cwd: root, gitBranch: "main" }),
      assistantTurn({ messageId: "msg_none", cwd: root }),
    ]);
    return { ...h, root, scope: { repositoryRoot: async () => root } };
  }

  function dimensionsByKey(transport: { readonly delivered: IngestBatch[] }) {
    return Object.fromEntries(
      transport.delivered
        .flatMap((batch) => batch.measurements)
        .map((entry) => [entry.idempotencyKey, entry.dimensions]),
    );
  }

  it("sends exactly what it sent before for a repository that declares no rules", async () => {
    const r = await repository(undefined, { AGENTMETER_SOURCE: "laptop-a" });
    const transport = transportOf(ACCEPT_ALL);

    const outcome = await runCollector(r.resolved, { transport }, r.scope);

    const sent = transport.delivered.flatMap((batch) => batch.measurements);
    expect(sent).toHaveLength(3);
    for (const entry of sent) {
      expect(Object.keys(entry).sort()).toEqual(
        ["idempotencyKey", "model", "occurredAt", "pricingTier", "sessionId", "tokens"].sort(),
      );
    }
    expect(JSON.stringify(transport.delivered)).not.toContain("laptop-a");
    expect(outcome.failures).toEqual([]);
    expect(outcome.scan.turnsAttributed).toBe(0);
  });

  it("sends what a branch rule captures, on the turns it matches and on no other", async () => {
    const r = await repository([TASK_RULE]);
    const transport = transportOf(ACCEPT_ALL);

    const outcome = await runCollector(r.resolved, { transport }, r.scope);

    expect(dimensionsByKey(transport)).toEqual({
      msg_task: [{ type: "task", key: "K123" }],
      msg_main: undefined,
      msg_none: undefined,
    });
    expect(JSON.stringify(transport.delivered)).not.toContain("add-export");
    expect(outcome.scan.turnsAttributed).toBe(1);
    expect(outcome.failures).toEqual([]);
  });

  it("sends the declared source name on every measurement when a source rule accepts it", async () => {
    const r = await repository([SOURCE_RULE], { AGENTMETER_SOURCE: "laptop-a" });
    const transport = transportOf(ACCEPT_ALL);

    const outcome = await runCollector(r.resolved, { transport }, r.scope);

    const name = [{ type: "checkout", key: "laptop-a" }];
    expect(dimensionsByKey(transport)).toEqual({ msg_task: name, msg_main: name, msg_none: name });
    expect(outcome.scan.turnsAttributed).toBe(3);
  });

  it("sends no name when none is declared, or when no source rule accepts it", async () => {
    const environments: Record<string, string>[] = [{}, { AGENTMETER_SOURCE: "Not A Slug" }];
    for (const env of environments) {
      const r = await repository([SOURCE_RULE], env);
      const transport = transportOf(ACCEPT_ALL);

      const outcome = await runCollector(r.resolved, { transport }, r.scope);

      expect(JSON.stringify(transport.delivered)).not.toContain("dimensions");
      expect(outcome.failures).toEqual([]);
    }
  });

  it("carries a task from the branch and a name from the variable on the same turn", async () => {
    const r = await repository([TASK_RULE, SOURCE_RULE], { AGENTMETER_SOURCE: "laptop-a" });
    const transport = transportOf(ACCEPT_ALL);

    await runCollector(r.resolved, { transport }, r.scope);

    expect(dimensionsByKey(transport).msg_task).toEqual([
      { type: "task", key: "K123" },
      { type: "checkout", key: "laptop-a" },
    ]);
  });

  it.each([
    ["is not JSON", "{ not json", "not-json"],
    [
      "holds a key it does not know",
      JSON.stringify({ version: 1, attribution: [], token: "x" }),
      "unknown-key",
    ],
    [
      "names a source it does not know",
      JSON.stringify({ version: 1, attribution: [{ ...TASK_RULE, from: "session" }] }),
      "unknown-source",
    ],
  ])("submits without dimensions, and says why, when the file %s", async (_name, file, detail) => {
    const r = await repository(undefined, { AGENTMETER_SOURCE: "laptop-a" }, file);
    const transport = transportOf(ACCEPT_ALL);

    const outcome = await runCollector(r.resolved, { transport }, r.scope);

    expect(transport.delivered.flatMap((batch) => batch.measurements)).toHaveLength(3);
    expect(JSON.stringify(transport.delivered)).not.toContain("dimensions");
    expect(outcome.failures).toEqual([
      { stage: "attribution", reason: "invalid-rules", count: 1, detail },
    ]);
    expect(outcome.scan.turnsAttributed).toBe(0);
  });

  it("submits without dimensions, and says so, when the file cannot be read", async () => {
    const r = await repository([TASK_RULE]);
    const transport = transportOf(ACCEPT_ALL);

    const outcome = await runCollector(
      r.resolved,
      { transport, loadRules: async () => ({ kind: "failed", reason: "unreadable-rules" }) },
      r.scope,
    );

    expect(transport.delivered.flatMap((batch) => batch.measurements)).toHaveLength(3);
    expect(JSON.stringify(transport.delivered)).not.toContain("dimensions");
    expect(outcome.failures).toEqual([
      { stage: "attribution", reason: "unreadable-rules", count: 1 },
    ]);
  });

  it("does not raise, and still submits, when loading the rules raises", async () => {
    const r = await repository([TASK_RULE]);
    const transport = transportOf(ACCEPT_ALL);

    const outcome = await runCollector(
      r.resolved,
      {
        transport,
        loadRules: async () => {
          throw new Error("unexpected");
        },
      },
      r.scope,
    );

    expect(transport.delivered.flatMap((batch) => batch.measurements)).toHaveLength(3);
    expect(JSON.stringify(transport.delivered)).not.toContain("dimensions");
    expect(outcome.failures).toEqual([
      { stage: "attribution", reason: "unreadable-rules", count: 1 },
    ]);
  });

  it("switches the rules off when a pattern does not answer in time, and reports it once", async () => {
    const r = await repository([TASK_RULE]);
    const transport = transportOf(ACCEPT_ALL);
    let asked = 0;

    const outcome = await runCollector(
      r.resolved,
      {
        transport,
        // The first branch is answered; the second is the one that never comes back.
        matchRule: (pattern, text) => {
          asked += 1;
          return asked === 1 ? guardedMatch(pattern, text) : { kind: "timeout" };
        },
      },
      r.scope,
    );

    expect(outcome.status).toBe("collected");
    expect(dimensionsByKey(transport)).toEqual({
      msg_task: [{ type: "task", key: "K123" }],
      msg_main: undefined,
      msg_none: undefined,
    });
    expect(outcome.failures).toEqual([{ stage: "attribution", reason: "rule-timeout", count: 1 }]);
    expect(transport.delivered.flatMap((batch) => batch.measurements)).toHaveLength(3);
  });

  it("is not held by a committed pattern that backtracks without bound", async () => {
    const r = await repository(
      [{ from: "source", match: "^(?<a>a+)+$", emit: [{ type: "checkout", key: "{a}" }] }],
      { AGENTMETER_SOURCE: `${"a".repeat(64)}!` },
    );
    const transport = transportOf(ACCEPT_ALL);

    const outcome = await runCollector(r.resolved, { transport }, r.scope);

    expect(outcome.failures).toEqual([{ stage: "attribution", reason: "rule-timeout", count: 1 }]);
    expect(transport.delivered.flatMap((batch) => batch.measurements)).toHaveLength(3);
    expect(JSON.stringify(transport.delivered)).not.toContain("dimensions");
  });

  it("reads no rule file and sends no dimension when the scope is the machine", async () => {
    const r = await repository([TASK_RULE, SOURCE_RULE], {
      AGENTMETER_SCOPE: "machine",
      AGENTMETER_SOURCE: "laptop-a",
    });
    const transport = transportOf(ACCEPT_ALL);
    const loadRules = vi.fn(async () => ({ kind: "none" }) as const);

    const outcome = await runCollector(r.resolved, { transport, loadRules }, r.scope);

    expect(loadRules).not.toHaveBeenCalled();
    expect(transport.delivered.flatMap((batch) => batch.measurements)).toHaveLength(3);
    expect(JSON.stringify(transport.delivered)).not.toContain("dimensions");
    expect(outcome.failures).toEqual([]);
  });

  it("reads the rules from the root the scope uses", async () => {
    const r = await repository([TASK_RULE]);
    const loadRules = vi.fn(async () => ({ kind: "none" }) as const);

    await runCollector(r.resolved, { transport: transportOf(ACCEPT_ALL), loadRules }, r.scope);

    expect(loadRules).toHaveBeenCalledTimes(1);
    expect(loadRules).toHaveBeenCalledWith(r.root);
  });

  it("lets no configuration value but the declared source name reach a dimension", async () => {
    const everything = {
      from: "source",
      match: "^(?<all>.+)$",
      emit: [{ type: "checkout", key: "{all}" }],
    };
    const h = await harness();
    const root = join(await makeTempDir("MARKER_ROOT_"), "widgets");
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, ATTRIBUTION_FILE),
      JSON.stringify({ version: 1, attribution: [everything] }),
      "utf8",
    );
    const transcriptsDir = join(await makeTempDir("MARKER_TRANSCRIPTS_"), "t");
    const cacheDir = join(await makeTempDir("MARKER_CACHE_"), "c");
    await writeTranscript(join(transcriptsDir, "sessions"), "s.jsonl", [
      assistantTurn({ messageId: "msg_a", cwd: root, gitBranch: "MARKER_BRANCH_NAME" }),
    ]);
    const resolved = resolveConfigFromEnv(
      {
        AGENTMETER_ENDPOINT: "https://marker-endpoint.invalid",
        AGENTMETER_TOKEN: "MARKER_TOKEN",
        AGENTMETER_TRANSCRIPTS_DIR: transcriptsDir,
        AGENTMETER_CACHE_DIR: cacheDir,
        AGENTMETER_SCOPE: "repository",
        AGENTMETER_SOURCE: "declared-source-name",
        AGENTMETER_MAX_BATCH_SIZE: "MARKER_NOT_A_NUMBER",
        XDG_CACHE_HOME: "/MARKER_XDG",
        HOME: "/MARKER_HOME",
        USER: "MARKER_USER",
        HOSTNAME: "MARKER_HOSTNAME",
      },
      "/MARKER_HOME",
    );
    const transport = transportOf(ACCEPT_ALL);

    await runCollector(resolved, { transport }, { repositoryRoot: async () => root });

    const sent = transport.delivered.flatMap((batch) => batch.measurements);
    expect(sent.map((entry) => entry.dimensions)).toEqual([
      [{ type: "checkout", key: "declared-source-name" }],
    ]);
    const serialised = JSON.stringify(transport.delivered);
    expect(serialised.split("declared-source-name")).toHaveLength(2);
    expect(serialised.toLowerCase()).not.toContain("marker");
    expect(h.resolved.status).toBe("configured");
  });

  it("keeps the dimensions in a retained batch and delivers them with it on a later run", async () => {
    const r = await repository([TASK_RULE]);
    await runCollector(r.resolved, { transport: transportOf(() => UNREACHABLE) }, r.scope);
    // The rules are gone by the next run: what was collected was already decided.
    await rm(join(r.root, ATTRIBUTION_FILE));
    const transport = transportOf(ACCEPT_ALL);

    await runCollector(r.resolved, { transport }, r.scope);

    expect(dimensionsByKey(transport).msg_task).toEqual([{ type: "task", key: "K123" }]);
  });

  it("reports counts and codes only: no branch, no name and no dimension in the outcome", async () => {
    const r = await repository([TASK_RULE, SOURCE_RULE], { AGENTMETER_SOURCE: "laptop-a" });

    const outcome = await runCollector(r.resolved, { transport: transportOf(ACCEPT_ALL) }, r.scope);

    const reported = `${JSON.stringify(outcome)} ${summarise(outcome)}`;
    for (const private_ of ["K123", "add-export", "laptop-a", "checkout"]) {
      expect(reported).not.toContain(private_);
    }
    expect(summarise(outcome)).toContain("attributed 3");
  });
});
