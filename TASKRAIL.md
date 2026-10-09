# Backlog

What is left to do on the collector, grouped into epics. An epic is an outcome: it states what
becomes true when it is done. Tasks live under the epic they serve.

**This file is a [taskrail](https://github.com/botarkdev/taskrail) backlog**
(`.taskrail/config.toml`). The CLI owns IDs and statuses: create, close and edit rows with
`.taskrail/bin/taskrail new|done|discard|edit`, never by hand, and run
`.taskrail/bin/taskrail validate` after touching this file. `taskrail show <ID>` names the skill
that works a task of its kind — `feature`, `bug`, `chore` or `spike`.

**IDs here are `C###`.** A `T###` anywhere in this repository — a comment in `src/`, the design
record under `specs/0019-claude-code-collector/` — is a row of the service's backlog, in
`botarkdev/agentmeter`, where the collector was built. Three tasks were open there when the
collector left and continue here: T013 as C002, T030 as C003 and T014 as C004.

A description is one or two lines: enough to know what the work is. A task that needs more links
a file under `docs/backlog/`.

## Epics

| ID  | Epic | Objective | File |
|-----|------|-----------|------|
| E01 | Collectors | Agents report usage without anyone thinking about it, and without ever being slowed down | —    |
| E02 | Repository and contract | The repository keeps its own record of what is left to do and holds its side of the contract with the service | —    |

## E01 — Collectors

Done when: a repository declares how its usage is attributed as configuration rather than code; what those rules derive can be withheld or hashed before it leaves the machine; and supporting a second agent means writing an adapter, not changing the run, the queue, the transport or the service.

| ✓  | ID   | Kind    | Pts | Depends On | Title                          | Description                    |
|----|------|---------|-----|------------|--------------------------------|--------------------------------|
| ✅ | C002 | feature | 5   | C001       | Attribution rules a repository declares | Was T013 in botarkdev/agentmeter. A repository declares in a committed file how its usage is attributed — the granularity it reports at and the rules that derive a dimension from what the collector can read locally, such as the branch — and the collector submits the result; all of it client-side, the service learning no vocabulary. Not in that file: the endpoint and the token, which stay in the environment, and which sessions are reported, which the repository scope already decides (specs/repository-scope/decision.md: selection, not attribution). A dimension is a new field on the wire and a value derived from a branch or a path, so under rule 2 what would leave the machine is the owner's decision: the plan states it exactly before anything is built. |
| ⬜ | C003 | feature | 3   | C002       | Privacy controls over attribution | Was T030 in botarkdev/agentmeter. Let a repository omit or hash any attribution dimension before it leaves the machine: branch names and paths describe a private repository's structure. Nothing derived from either is sent today, so this governs only what C002 adds; which treatment is the default is decided in its plan, and the allowlist projection and the content-safety test remain the enforcement. |
| ⬜ | C004 | feature | 5   | C002       | Second agent adapter           | Was T014 in botarkdev/agentmeter. A coding agent other than Claude Code (the design record names opencode) reporting through the same ingestion contract, as an adapter beside src/claude-code/ with no change to the wire shape, the queue, the transport or the service: this is what proves the adapter boundary is real. It holds the four rules and the repository scope, which is decided today from Claude Code's project directories and recorded working directories and needs its equivalent for the new agent's logs. |

## E02 — Repository and contract

Done when: the work left on the collector is a backlog in this repository, worked through its own checks; and a change to the service's ingestion contract that the collector does not follow fails a test here.

| ✓  | ID   | Kind    | Pts | Depends On | Title                          | Description                    |
|----|------|---------|-----|------------|--------------------------------|--------------------------------|
| ✅ | C001 | chore   | 1   | —          | Adopt taskrail with a backlog of the collector's own | Install taskrail, pinned, with the configuration this repository's checks and autopilot need, and open the backlog with the three tasks that were open in the service's repository when the collector left it (T013, T030 and T014 there). |
| ✅ | C005 | chore   | 2   | C001       | Check the collector's contract against the service's pinned document | The service pins the request and response shapes this collector relies on in apps/api/contracts/collector-ingest.json of botarkdev/agentmeter. Commit a copy of that document here, with its source commit, its version and its SHA-256 recorded beside it, and add a unit test that reads the copy and fails when the collector's wire shape, batching, acceptance reading or classification of refusals departs from it. No runtime dependency, nothing read over the network; refreshing the copy is a manual step. Detail: [docs/backlog/C005-service-contract-check.md](docs/backlog/C005-service-contract-check.md). |
| ✅ | C006 | chore   | 1   | —          | License the collector under Apache-2.0 | Was T167 in botarkdev/agentmeter. LICENSE is the service's proprietary notice, carried over in the split: it grants nobody permission to use a package the README tells people to install, and package.json has no license field. The owner chose Apache-2.0 on 2026-10-09. Replace LICENSE with the Apache License 2.0 text, set the license field, state the licence in the README, and bring every sentence that describes the licence in line. |
