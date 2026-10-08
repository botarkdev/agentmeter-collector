# A run reports one repository

**Date**: 2026-10-08. **Status**: decided by the owner; implemented with this document.

**It reverses one decision of `specs/0019-claude-code-collector/`**, which that record still states
as it was taken: that the collector walks every transcript on the machine and "nothing reads a
directory name for meaning", every transcript belonging to "the one project the configured ingest
token names". That held while the collector had one user and one project. It stops holding the
moment a second repository installs the hook.

## The problem

One ingest token names one project on the service. A developer's machine holds the transcripts of
every repository they work in. A `SessionEnd` hook installed in one repository therefore reported
every repository's usage into that repository's project — and a second repository with the hook
reported all of it again into its own, each under its own token.

Measured on the owner's machine on the day of the decision, with the endpoint a placeholder and a
throwaway cache: the whole machine holds 47 000 distinct usage turns; the repository the run was
started in holds 8 233 of them.

## What was decided

**A run reports the repository it was started in.** That is the default. `AGENTMETER_SCOPE=machine`
reports every transcript, as before.

**Which repository that is**: the nearest `.git` above the directory the run was started in. A
`.git` directory is a main working tree. A `.git` file naming `<main>/.git/worktrees/<name>` is a
linked worktree, and the repository is its main working tree — so a session opened in a worktree
reports into the same scope as one opened at the root. With no `.git` above it, the starting
directory is the scope. Nothing is spawned: `git` may not be installed where a hook runs, and a
child process is a way to hold a session close open.

**Which turns belong to it** — either of:

1. **The transcript is in the repository's own Claude Code project directory.** Claude Code keeps
   one directory per directory a session was opened in, named after that path with every character
   that is not a letter or a digit replaced by a hyphen. Every turn in the repository's own belongs
   to it, whatever directory the turn ran in and whatever path the repository had at the time.
2. **The turn's recorded working directory is inside the repository.** A session opened in a
   worktree or a subdirectory is kept under another project directory, and only its turns say where
   they ran.

Rule 1 is compared on the whole directory name. A prefix would hand `…-agentmeter` the sessions of
`…-agentmeter-collector` beside it; both exist on the owner's machine. Rule 2 is compared on whole
path segments for the same reason.

Rule 1 exists for a case rule 2 cannot see: **a repository that was moved.** Its earlier turns
record the old path. They are kept as long as the project directory was moved with the repository,
and lost to the scope otherwise.

**A turn that records no working directory**, outside the repository's own project directory, is
not reported: nothing shows it belongs.

## What it does not change

**Nothing new is transmitted.** A working directory is read, handed to the scope, and dropped. The
turn that results has the same five fields and five counters as before, and no field a path could
travel in. `test/unit/contract/content-safety.unit.test.ts` is unchanged and still holds;
`test/unit/run/run-collector.unit.test.ts` adds the same assertion for a scoped run. The module
that reads the transcript event is still the only one that ever holds it.

**The run still cannot fail a session.** Finding the repository never throws. If it somehow did, the
run reports nothing and says so — it does not fall back to the whole machine, which is the one
outcome the scope exists to prevent.

## What it costs, and what it required

**Every transcript is still read.** Only a turn says where it ran, so a run reads the machine's
transcripts to find the ones that are its own. The scan cursor makes that a first-run cost: what a
run kept nothing from is recorded as read like anything else.

**The queue and the cursor became per repository**, under `repositories/<digest>` in the cache
directory, where the digest is of the repository's root. Shared, both were wrong:

- a queued batch holds no token, on purpose, so that a rotated token recovers a backlog. A queue
  two repositories share is drained by whichever runs next, under its token, into the wrong
  project;
- a shared cursor says a transcript was read by a run that kept none of it, so the repository it
  belongs to never reads it.

Both have a test that was seen failing with the shared directory restored.

A run with `AGENTMETER_SCOPE=machine` keeps its queue and cursor where they always were.

**The outcome gained one count**, `scan.turnsOutOfScope`, printed as `out-of-scope N` when it is not
zero. Without it a scope that matches nothing is indistinguishable from a machine with no usage.

## Known limits

- **Two paths that differ only in punctuation share a project directory name** (`/a/b-c` and
  `/a/b/c`). Rule 1 would take both. Accepted: it needs two repositories at such paths on one
  machine.
- **A repository moved without its Claude Code project directory** keeps only the turns written
  after the move.
- **The project directory's name is observed, not documented.** If Claude Code changes it, rule 1
  claims nothing and rule 2 still selects every turn that ran inside the repository.
- **A turn is attributed to where the session ran, not to what it edited.** A session opened in one
  repository that works on another is the first repository's usage.
- **This is selection, not attribution.** Which branch, task or directory a turn served is still not
  derived and still not sent.
