# Research: Claude Code collector

**Feature**: `0019-claude-code-collector` · **Date**: 2026-08-20

Phase 0 for `plan.md`. Every decision below that concerns transcript shape was checked against
real Claude Code transcripts on the machine this was written on — 60 files, 17 591 assistant
turns carrying usage — rather than inferred from the reference implementation. Three of them
contradict what reading `scripts/usage-report.mjs` alone would have suggested, and one of those
is a latent defect in the reference itself.

The measurement commands are recorded with each decision so the numbers can be re-derived. They
read only from the local Claude Code transcript directory; nothing about this machine, its
paths, or its projects is recorded here.

---

## Decision 1 — The idempotency key is the assistant message id, alone

**Decision**: `idempotencyKey` is the transcript event's `message.id` verbatim (`msg_…`). Not the
reference's `requestId:messageId` composite, not anything containing the session id, the file
name, the model, or an ordinal.

**Evidence** (counts over 60 transcripts, 17 591 assistant turns with usage):

| Observation | Count | What it rules out |
| --- | ---: | --- |
| Distinct `message.id` values | 8 667 | — |
| Ids appearing on **more than one transcript line** | 5 616 | Any design without in-run deduplication. Duplicates are the norm, not an edge case. |
| Ids appearing in **more than one file, under more than one `sessionId`** | 404 | Any key containing `sessionId` or the file identity — a resumed session rewrites earlier turns under a new session id, and such a key would charge them twice. |
| Ids with two different `requestId` values | 0 | The composite's extra component buys nothing. |
| Turns with **no `requestId`** | 14 | The composite is not always derivable; a key component that is sometimes absent is exactly the instability that turns a retry into a double count. |
| Turns with no `message.id` | 0 | — |

**Why not the composite the architecture proposal shows.** §4's example payload uses
`req_…:msg_…`, and the reference deduplicates on the same pair. But that document's own words are
that the key is "whatever the client considers unique" — the example is an example of a client's
choice, not a contract. Given the table above, the composite is the same key with an optional
component bolted on: it never distinguishes two turns that `message.id` conflates (0 cases), and
it fails to key 14 turns that `message.id` keys fine.

**Why not a session-level key.** `<sessionId>|<model>|<tier>`, from the proposal's migration
plan, names a bucket whose counts grow while the session runs and grow again when it is resumed.
The service's ledger is keyed on the idempotency key alone, so the second, larger send is
deduplicated and the extra tokens are lost silently. The 404 cross-session ids above make this
concrete rather than theoretical. Recorded as a clarification in `spec.md`.

**Cost accepted**: row volume (architecture proposal §7.3). Bounded by batching; recoverable
later by adding a session-granularity option in T013, where configuration lives. The lost tokens
under the alternative would not be recoverable.

## Decision 2 — Duplicate turns are collapsed by *greatest* token total, not by first seen

**Decision**: when a run sees the same key more than once, it keeps the occurrence with the
greatest total across the five counters; a tie keeps the first. The result does not depend on
the order files were read in.

**Evidence**: 7 of 8 667 message ids carry **different** usage values across their duplicate
lines. In every one, one line is a partial record — the cache-creation count only, with input,
output and cache-read all zero — and another is complete:

```text
msg_011Cdi… line 1: input 0, output 0,   cacheRead 0,       cacheWrite1h 714
msg_011Cdi… line 2: input 2, output 203, cacheRead 995 198, cacheWrite1h 714
```

**This is a defect in the reference implementation.** `scanFile` registers the key in its global
`seen` set on first sight and `continue`s past every later occurrence, so for these turns it
records the partial line and discards the complete one — under-counting 203 to 756 output tokens
and up to a megatoken of cache reads apiece. Small in aggregate (0.08% of turns) and invisible,
which is why it survived.

**Why "greatest" and not "last"**: "last" makes the result depend on directory iteration order,
which is not stable across filesystems. "Greatest" is order-independent, which is also what makes
it testable without asserting on a mechanism.

**Residual limitation, documented not fixed**: if a run reads a transcript between the partial
line and the complete one being written, it sends the partial counts, and the service's ledger
correctly refuses to overwrite them on the next run — idempotency and correction are in tension
by design (Constitution, Principle II: a measurement is never rewritten). Running from a
`SessionEnd` hook means the session is over and both lines are present. Noted for the backlog.

## Decision 3 — Turns whose five counters are all zero are skipped

**Decision**: a turn contributing nothing to any of the five buckets is not submitted.

**Evidence**: 36 of 17 591 turns have all counters at zero. All 21 turns whose model is
`<synthetic>` — Claude Code's placeholder for an API error notice or an interface message, not a
model call — are among them.

**Why this rule and not "skip `<synthetic>`"**: the zero rule is agent-agnostic and needs no
list of an agent's internal sentinel values, so a future sentinel is handled without a change
here. It also keeps a phantom model name out of a public service's unpriced-model report, which
is what submitting `<synthetic>` as a model would produce.

## Decision 4 — Token buckets are derived exactly as the reference derives them

**Decision**: `input` ← `usage.input_tokens`; `output` ← `usage.output_tokens`; `cacheRead` ←
`usage.cache_read_input_tokens`; `cacheWrite1h` ← `usage.cache_creation.ephemeral_1h_input_tokens`;
`cacheWrite5m` ← `usage.cache_creation.ephemeral_5m_input_tokens`, falling back to
`max(0, usage.cache_creation_input_tokens − cacheWrite1h)` when the itemised field is absent.
Missing counters are zero; a counter that is present but not a non-negative integer makes the
turn malformed.

**Evidence**: `usage.cache_creation` was present on all 17 591 turns, and
`cache_creation_input_tokens` on all of them too, so the fallback is currently unexercised in the
wild — it is kept because it is what makes older transcripts (the ones the reference was written
against) still readable, and because FR-005 requires parity with what the reference would have
recorded. In 15 turns the itemised counts do not sum to the flat one; the itemised values win,
which is the reference's behaviour.

`usage.service_tier` exists on these turns and is **not** used. It is the API's
standard/batch/priority service class, not the introductory-vs-standard *pricing* tier the
service's contract means, and conflating the two would misprice every measurement.

`usage.iterations`, `usage.server_tool_use`, `usage.output_tokens_details`, `usage.speed` and
`usage.inference_geo` are likewise not read: they are outside the five buckets the service
stores.

## Decision 5 — The wire payload is built by an allowlist projection, never by filtering

**Decision**: one function constructs the outbound entry field by field from named inputs. There
is no path by which a transcript object, or any part of one, reaches the request body — nothing
is spread, copied, or passed through and then stripped.

**Why it matters here specifically**: the top-level fields actually present on these transcript
events include `cwd`, `gitBranch`, `slug`, `attributionSkill`, `entrypoint`, `error` and
`message` — the developer's directory layout, branch names, and the full text of every prompt,
tool call and file the agent read. The service is about to be public.

A denylist would have to be updated every time Claude Code adds a field, and would be wrong
silently until someone noticed. An allowlist is wrong loudly — a field nobody added simply is not
there. FR-026 requires this be a test, so the test builds a transcript in which *every*
content-bearing field carries a distinctive marker and asserts no marker survives serialisation.

## Decision 6 — Undelivered work is one file per batch, written then renamed

**Decision**: `${XDG_CACHE_HOME:-$HOME/.cache}/agentmeter/queue/<sortable-name>.json`, written to
a `.tmp` name in the same directory and `rename`d into place. Draining reads names in sort order,
oldest first, and unlinks a file only after the service has accounted for it.

**Why not one append-only file**: two `SessionEnd` hooks can fire at the same moment. Concurrent
appends interleave and corrupt, and defending that needs a lock — one more thing that can hang a
session close (Principle IV). `rename` within a directory is atomic on every POSIX filesystem, so
a partially written batch never has a name the drain can see (FR-017), and two runs never choose
the same name (FR-016).

**Name format**: `<epoch-millis>-<random>.json`. Zero-padded millis sort lexicographically in
time order for the next ~250 years; the random suffix makes a collision between two runs
starting in the same millisecond a non-event.

## Decision 7 — The retention ceiling is a count of batches, enforced at enqueue

**Decision**: a maximum number of retained batch files, default 512, oldest discarded first, and
the discard is reported.

**Why a count rather than a byte budget**: enforcing a count means listing a directory; enforcing
bytes means `stat`-ing every file in it, on the session-close path. Each batch is already bounded
by the per-request entry limit, so bounding the count bounds the bytes to a known multiple. 512
batches at 200 entries is a hundred thousand measurements — weeks of a heavy user's outage — and
a few tens of megabytes at most.

## Decision 8 — Local scan state is a cursor, and correctness never touches it

**Decision**: a single JSON file recording, per transcript path, the size and modification time
last read and the byte offset reached. A file whose size and mtime are unchanged is skipped
entirely; a file that has grown is read from the recorded offset.

**Ordering**: the batch is enqueued *before* the cursor advances. A crash in between re-reads and
re-enqueues, and the service deduplicates — the failure mode is a redundant send, never a lost
one.

**Why it exists at all**: Principle III permits local state only as an optimisation, and this is
one — deleting the cursor file re-reads everything, resubmits it, and the ledger absorbs it, so
the only observable difference is how long a run takes. Without it every session close rescans
every transcript the developer has ever produced. On the machine these numbers came from that is
already tens of megabytes across 24 project directories, and it grows forever: this is the
concrete mechanism by which the collector would come to violate Principle IV.

**Only whole lines count.** A read stops at the last newline; a trailing partial line is not
parsed and not included in the recorded offset, so the tail of a live transcript is picked up
whole on the next run (FR-017, US4).

## Decision 9 — The pricing tier is configuration, defaulting to `standard`

**Decision**: `pricingTier` is a configured string, `standard` unless overridden.

**Why**: the service treats the tier as the client's assertion, and a price entry's intro cutoff
is explicitly informational rather than selective (`specs/0014-pricing-cost-calc/spec.md` FR-005,
FR-007). The collector holds no price table — centralising pricing is the point of T007 — so it
cannot compute the tier. `unknown` would make every measurement permanently unpriced, and the
tier is stored on the immutable measurement, so not even retroactive repricing (T008) could
recover it. `standard` is correct for every model outside an introductory window.

**Gap recorded, not closed**: nothing published by the service today lets a collector learn which
models are inside an introductory window at a given instant. Closing it is pricing's work, not
this feature's, and it is named in the handover rather than papered over here.

## Decision 10 — Zero runtime dependencies

**Decision**: `node:fs`, `node:fs/promises`, `node:path`, `node:os`, `node:readline`, and the
global `fetch`/`AbortSignal` that Node 22 provides. Nothing added to `package.json`'s
`dependencies`.

**Why**: the architecture proposal's own stack table says "npm package, zero heavy dependencies —
it runs inside a hook: startup has to be fast." Every dependency is module resolution work on the
session-close path, and for a package third parties install, every dependency is also supply
chain. Node 22 is already this workspace's floor (`engines.node`).

**Consequence for validation**: the collector does not re-validate its own payload with Zod. The
Constitution requires that a schema shared between the API and the collector live in a shared
package rather than be duplicated — so the collector defines no second copy of the ingest schema.
Its outbound shape is a TypeScript type over the allowlist projection of Decision 5, and the
service is the authority that validates. Moving `ingest-request.schema.ts` into
`packages/schema` so both sides read one schema is a real improvement, but it edits `apps/api`,
which this feature does not touch; it is named in the handover.

## Decision 11 — A library, with a thin runnable wrapper over it

**Decision**: the unit of work is `runCollector(config)`, which returns an outcome and never
rejects. `runCli(argv, io)` wraps it, prints the outcome, and returns an exit code that is always
0. `src/cli/agentmeter.ts` is a two-line shebang bootstrap over `runCli`, built to `dist` by the
same `tsc -p tsconfig.build.json` pattern `apps/api` already uses, and exposed as the package's
`bin`.

**Why the split**: FR-014 and FR-015 are properties of a process — an exit code and a wall clock —
and a library alone cannot demonstrate them. But spawning processes in a unit suite is slow and
flaky, so the boundary is drawn so that everything except `process.exit` and `process.argv` is an
ordinary function taking its io as a parameter. The bootstrap file carries no logic and is not
tested (Constitution, Principle VII: bootstrap files MUST NOT be tested); it is the single
coverage exclusion this package declares.

## Decision 12 — Nothing this feature builds derives a dimension

**Decision**: submitted entries carry no `dimensions` array at all.

**Why**: attribution is T013, and privacy controls over attribution are T030. Deriving a
dimension here would mean reading `gitBranch` or `cwd` — the two fields Decision 5 exists to keep
off the wire — and would have to be redesigned the moment T013 gives a repository a way to
declare its own rules. The service stays ignorant either way (Principle I); this simply keeps the
client ignorant too, until the task that owns the question.
