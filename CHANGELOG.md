# Changelog

All notable changes to the **collector** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are cut **per target**: collector is versioned and tagged independently of every
other workspace member, using the tag form `@agentmeter/collector/vX.Y.Z`. Sections here are written
by `scripts/generate-changelog.mjs` at release time, from the same Conventional
Commits the version bump is computed from.

Sections headed `## <version> — <date>`, further down, predate that script: they were written by
this repository's earlier release command (spec 0039) and are kept exactly as they were.

## [Unreleased]

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
