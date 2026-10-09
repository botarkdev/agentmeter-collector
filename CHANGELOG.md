# Changelog

All notable changes to the **collector** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions up to 0.1.1 were released from the agentmeter monorepo, where this package lived as
`packages/collector` until it moved to a repository of its own; their sections are kept exactly as
they were written there, and the pull request numbers in them are that repository's.

## [Unreleased]

## 0.3.0 — 2026-10-09

### Added

- **Attribution rules a repository declares.** A repository that commits `.agentmeter.json` at
  its root has `dimensions` sent with each measurement: pairs of a `type` written in that file and
  a `key` built from what the file's own patterns capture of the turn's recorded branch name, or
  of the name declared in the new variable `AGENTMETER_SOURCE`. A repository without the file
  sends exactly what it sent before. `README.md`, "Attribution";
  `specs/attribution-rules/decision.md`.
- `AGENTMETER_SOURCE`: a name for where the metrics come from. It is sent only through a `source`
  rule of the committed file.
- The run outcome carries `scan.turnsAttributed`, the failure stage `attribution` and the reasons
  `invalid-rules`, `unreadable-rules` and `rule-timeout`.
- The `WireDimension` type, and `dimensions` on `MeasurementEntry`.

### Changed

- **The package is licensed under Apache-2.0.** It used to carry a notice that granted nobody
  permission to use it. `LICENSE` is the licence's text, `NOTICE` names the copyright holder, both
  ship in the package, and `package.json` declares `"license": "Apache-2.0"`.

## 0.2.0 — 2026-10-08

The first release from this repository, and the first that can be installed without a clone.

### Added

- The package ships its built output. Each release attaches it to a GitHub release of this
  repository and publishes it as a tree tagged `dist-v<version>`, so it installs by address or
  straight from git; `README.md`, "Install it". Installing it builds nothing and runs no script.
- Type declarations.

### Changed

- **A run reports only the repository it was started in.** It used to report every transcript on
  the machine under whichever token ran the hook. `AGENTMETER_SCOPE=machine` restores that. The
  queue and the scan cursor are now kept per repository, so anything retained under the old,
  shared cache directory is no longer delivered by a repository-scoped run; the service
  deduplicates whatever is re-read.
- The run outcome carries `scan.turnsOutOfScope`.

## 0.1.1 — 2026-10-04

### Fixed

- fix(0006:ci:coverage): declare text-summary explicitly so CI publishes the coverage summary (#110) ([a8e98eb])

## 0.1.0 — 2026-09-08

### Added

- feat(0019:collector): scan Claude Code transcripts, queue to disk, and send (#28) ([b9e783f])

### Fixed

- fix(ci): run each suite once, under coverage, in its own step (#63) ([397aad3])

### Unknown

- 0001 monorepo scaffolding (#1) ([33dbbdc])
