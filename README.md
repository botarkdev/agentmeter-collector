# @agentmeter/collector

Per-agent adapters that will read local Claude Code / opencode logs and normalize them to
agentmeter's ingestion format (`docs/00-architecture-proposal.md` §5). As of T001 (Monorepo
Scaffolding), this package is scaffolding only — a placeholder export and a passing test, no
product logic. It exists as a workspace member with its own build/test scripts so later specs
have somewhere to land.

## Commands

Run from this directory, or via `pnpm --filter @agentmeter/collector <script>` from the
repository root.

| Command | What it does |
| --- | --- |
| `pnpm test:unit` | Runs `*.unit.test.ts`. |
| `pnpm test:cov` | Runs the unit suite with coverage; fails below the declared 80% threshold. |

## Configuration

No environment variables in this task.
