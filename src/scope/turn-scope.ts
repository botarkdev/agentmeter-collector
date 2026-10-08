import { createHash } from "node:crypto";
import { join, relative, resolve, sep } from "node:path";

/**
 * Which turns a run reports (specs/repository-scope/decision.md).
 *
 * One ingest token names one project on the service, and a machine holds the transcripts of every
 * repository its owner works in. Reporting all of them under one token files every repository's
 * usage under whichever one happened to run the hook. So a run is scoped to one repository, and a
 * turn belongs to it when either is true:
 *
 * - **its transcript is in the repository's own project directory.** Claude Code keeps one
 *   directory per directory a session was opened in, named after that path. Everything in the
 *   repository's own is that repository's session, whatever directory a turn later ran in, and
 *   whatever path the repository had when the turn was written — which is what keeps the history
 *   of a repository that was moved, as long as its project directory was moved with it.
 * - **the turn ran inside the repository.** A session opened in a worktree or a subdirectory is
 *   kept in another project directory, and only the working directory recorded on each turn says
 *   it belongs here.
 *
 * Both read a path to decide; neither sends one. Selecting is not transmitting: a turn that is
 * selected is projected to the same fields as before, and there is still no field a path could
 * travel in (spec.md FR-024, FR-025).
 */
export interface TurnScope {
  /** True when every turn in this transcript belongs, without looking at any of them. */
  readonly acceptsTranscript: (path: string) => boolean;
  /** Asked per turn, for a transcript `acceptsTranscript` did not claim. A turn that records no
   * working directory cannot be shown to belong, so it does not. */
  readonly acceptsWorkingDirectory: (workingDirectory: string | undefined) => boolean;
}

/**
 * The name Claude Code gives the project directory of a session opened in `directory`: the path
 * with every character that is not a letter or a digit replaced by a hyphen. Observed, not
 * documented. If it ever stops matching, the first rule above claims nothing and the second still
 * selects every turn that ran inside the repository.
 */
export function claudeProjectDirectoryName(directory: string): string {
  return resolve(directory).replace(/[^A-Za-z0-9]/g, "-");
}

export function isWithinDirectory(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  if (resolvedCandidate === resolvedRoot) {
    return true;
  }
  const prefix = resolvedRoot.endsWith(sep) ? resolvedRoot : `${resolvedRoot}${sep}`;
  return resolvedCandidate.startsWith(prefix);
}

export function repositoryScope(repositoryRoot: string, transcriptsDir: string): TurnScope {
  const projectDirectory = claudeProjectDirectoryName(repositoryRoot);
  return {
    acceptsTranscript: (path) => {
      // The FIRST segment under the transcripts root, compared whole: a prefix match would hand
      // `…-agentmeter` the transcripts of `…-agentmeter-collector` beside it.
      const [first] = relative(resolve(transcriptsDir), resolve(path)).split(sep);
      return first === projectDirectory;
    },
    acceptsWorkingDirectory: (workingDirectory) =>
      workingDirectory !== undefined && isWithinDirectory(repositoryRoot, workingDirectory),
  };
}

/**
 * Where a repository's queue and cursor live under the configured cache directory.
 *
 * They cannot be shared between repositories. A queued batch holds no token — that is what lets a
 * rotated token recover a backlog — so a queue two repositories share is drained by whichever
 * runs next, under ITS token, into the wrong project. And a shared cursor records that a
 * transcript was read by a run that kept none of it, so the repository it belongs to never reads
 * it at all.
 *
 * The directory is named by a digest of the root rather than by the root itself: a path is not a
 * safe file name, and the digest keeps the name fixed-length. It never leaves the machine.
 */
export function repositoryCacheDirectory(cacheDir: string, repositoryRoot: string): string {
  const digest = createHash("sha256").update(resolve(repositoryRoot)).digest("hex").slice(0, 16);
  return join(cacheDir, "repositories", digest);
}
