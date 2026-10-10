/**
 * `@agentmeter/collector` — reads a coding agent's local usage logs and reports them to
 * agentmeter, without ever blocking or failing the agent session that produced them.
 *
 * See `specs/0019-claude-code-collector/` for what this does and why it does it that way. The two
 * properties worth knowing before using it:
 *
 * - `runCollector` never rejects. Every failure — unreachable service, expired token, unreadable
 *   transcript, full disk — is data in the returned outcome.
 * - Only counters and identifiers leave the machine, plus — for a repository that committed
 *   attribution rules — what those rules capture of a branch name or of a name the user declared
 *   (`specs/attribution-rules/decision.md`), as a digest or not at all when that repository's
 *   file says so (`specs/attribution-privacy/decision.md`). Nothing derived from message
 *   content, file contents, paths or a session's name is transmitted, and that is enforced by
 *   construction rather than by convention.
 *
 * Only what a caller needs is exported. The scanning, queueing and transport internals are not
 * part of this package's contract and may change without notice.
 */

export { runCollector } from "./run/run-collector.js";
export type { RunDependencies, ScopeDependencies } from "./run/run-collector.js";

export { resolveConfigFromEnv } from "./config/collector-config.js";
export type {
  CollectionScope,
  CollectorConfig,
  ResolvedConfig,
} from "./config/collector-config.js";

export { runCli, summarise } from "./cli/run-cli.js";
export type { CliIo } from "./cli/run-cli.js";

export type {
  DeliverySummary,
  FailureReason,
  FailureRecord,
  FailureStage,
  QueueSummary,
  RunOutcome,
  ScanSummary,
  SkipReason,
  SkipRecord,
} from "./run/run-outcome.js";

export { CLAUDE_CODE_AGENT, INGEST_PATH } from "./contract/ingest-contract.js";
export type { IngestBatch, MeasurementEntry, WireDimension } from "./contract/ingest-contract.js";
