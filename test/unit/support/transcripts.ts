import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Fixtures for the unit suite.
 *
 * Several modules here (`transcript-reader`, `batch-queue`, `scan-cursor`) exist precisely to get
 * filesystem semantics right — whole-line reads at byte offsets, atomic rename, a partially
 * written file never being visible. Those are properties of the filesystem, and a mocked `fs`
 * would assert only that the mock was called, which is the shape of a test that cannot fail for
 * the reason it names. So they run against a real temporary directory: no network, nothing
 * outside `os.tmpdir()`, and never the developer's own `~/.claude`.
 *
 * Everything genuinely injected — the clock, the transport, the queue — is still substituted.
 */

export async function makeTempDir(prefix = "agentmeter-test-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export interface AssistantTurnOptions {
  readonly messageId?: string | null;
  readonly requestId?: string;
  readonly sessionId?: string | null;
  readonly timestamp?: string | null;
  readonly model?: string | null;
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
  readonly cacheWrite5m?: number;
  readonly cacheWrite1h?: number;
  /** Set instead of the itemised `cache_creation` object, to exercise the fallback derivation. */
  readonly flatCacheCreation?: number;
  readonly omitItemisedCacheCreation?: boolean;
  /** The working directory the turn records. Absent by default, as on a turn that records none. */
  readonly cwd?: string;
}

/** One assistant turn, shaped like the real thing. Fields set to `null` are omitted entirely, so
 * a test can say "this turn has no model" without inventing a different shape. */
export function assistantTurn(options: AssistantTurnOptions = {}): Record<string, unknown> {
  const usage: Record<string, unknown> = {
    input_tokens: options.input ?? 10,
    output_tokens: options.output ?? 20,
    cache_read_input_tokens: options.cacheRead ?? 0,
  };
  if (options.flatCacheCreation !== undefined) {
    usage.cache_creation_input_tokens = options.flatCacheCreation;
  }
  if (options.omitItemisedCacheCreation !== true) {
    usage.cache_creation = {
      ephemeral_5m_input_tokens: options.cacheWrite5m ?? 0,
      ephemeral_1h_input_tokens: options.cacheWrite1h ?? 0,
    };
  }

  const message: Record<string, unknown> = { usage };
  if (options.messageId !== null) {
    message.id = options.messageId ?? "msg_default";
  }
  if (options.model !== null) {
    message.model = options.model ?? "claude-opus-5";
  }

  const event: Record<string, unknown> = { type: "assistant", message };
  if (options.timestamp !== null) {
    event.timestamp = options.timestamp ?? "2026-08-20T10:00:00.000Z";
  }
  if (options.sessionId !== null) {
    event.sessionId = options.sessionId ?? "session-1";
  }
  if (options.requestId !== undefined) {
    event.requestId = options.requestId;
  }
  if (options.cwd !== undefined) {
    event.cwd = options.cwd;
  }
  return event;
}

/**
 * A transcript event carrying a distinctive marker in every content-bearing field the real format
 * is known to have, plus several this test invents. Used by the content-safety test: nothing in
 * here except the counters and identifiers may survive projection.
 */
export const MARKERS = {
  prompt: "MARKER_PROMPT_TEXT",
  toolInput: "MARKER_TOOL_INPUT",
  toolResult: "MARKER_TOOL_RESULT",
  cwd: "MARKER_WORKING_DIRECTORY",
  branch: "MARKER_GIT_BRANCH",
  slug: "MARKER_SLUG",
  entrypoint: "MARKER_ENTRYPOINT",
  error: "MARKER_ERROR_TEXT",
  uuid: "MARKER_UUID",
  future: "MARKER_FIELD_NOBODY_HAS_SEEN_YET",
} as const;

export function markerTranscriptEvent(): Record<string, unknown> {
  return {
    type: "assistant",
    timestamp: "2026-08-20T10:00:00.000Z",
    sessionId: "session-marker",
    requestId: "req_marker",
    cwd: `/home/someone/${MARKERS.cwd}`,
    gitBranch: MARKERS.branch,
    slug: MARKERS.slug,
    entrypoint: MARKERS.entrypoint,
    error: MARKERS.error,
    uuid: MARKERS.uuid,
    parentUuid: MARKERS.uuid,
    attributionSkill: MARKERS.slug,
    somethingAddedInAFutureVersion: MARKERS.future,
    message: {
      id: "msg_marker",
      model: "claude-opus-5",
      content: [
        { type: "text", text: MARKERS.prompt },
        { type: "tool_use", name: "Read", input: { file_path: MARKERS.toolInput } },
        { type: "tool_result", content: MARKERS.toolResult },
      ],
      usage: {
        input_tokens: 5,
        output_tokens: 7,
        cache_read_input_tokens: 11,
        cache_creation_input_tokens: 13,
        cache_creation: {
          ephemeral_5m_input_tokens: 13,
          ephemeral_1h_input_tokens: 0,
        },
      },
    },
  };
}

/** Writes JSONL lines (already-stringified or objects) into `<dir>/<name>`. */
export async function writeTranscript(
  directory: string,
  name: string,
  lines: readonly (string | Record<string, unknown>)[],
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const path = join(directory, name);
  const body = lines
    .map((line) => (typeof line === "string" ? line : JSON.stringify(line)))
    .join("\n");
  await writeFile(path, lines.length === 0 ? "" : `${body}\n`, "utf8");
  return path;
}
