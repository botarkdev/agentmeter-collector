import { createHash } from "node:crypto";
import { join, relative, resolve, sep } from "node:path";
/**
 * The name Claude Code gives the project directory of a session opened in `directory`: the path
 * with every character that is not a letter or a digit replaced by a hyphen. Observed, not
 * documented. If it ever stops matching, the first rule above claims nothing and the second still
 * selects every turn that ran inside the repository.
 */
export function claudeProjectDirectoryName(directory) {
    return resolve(directory).replace(/[^A-Za-z0-9]/g, "-");
}
export function isWithinDirectory(root, candidate) {
    const resolvedRoot = resolve(root);
    const resolvedCandidate = resolve(candidate);
    if (resolvedCandidate === resolvedRoot) {
        return true;
    }
    const prefix = resolvedRoot.endsWith(sep) ? resolvedRoot : `${resolvedRoot}${sep}`;
    return resolvedCandidate.startsWith(prefix);
}
export function repositoryScope(repositoryRoot, transcriptsDir) {
    const projectDirectory = claudeProjectDirectoryName(repositoryRoot);
    return {
        acceptsTranscript: (path) => {
            // The FIRST segment under the transcripts root, compared whole: a prefix match would hand
            // `…-agentmeter` the transcripts of `…-agentmeter-collector` beside it.
            const [first] = relative(resolve(transcriptsDir), resolve(path)).split(sep);
            return first === projectDirectory;
        },
        acceptsWorkingDirectory: (workingDirectory) => workingDirectory !== undefined && isWithinDirectory(repositoryRoot, workingDirectory),
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
export function repositoryCacheDirectory(cacheDir, repositoryRoot) {
    const digest = createHash("sha256").update(resolve(repositoryRoot)).digest("hex").slice(0, 16);
    return join(cacheDir, "repositories", digest);
}
