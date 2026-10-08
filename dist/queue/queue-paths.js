import { join } from "node:path";
/**
 * Where the collector keeps the two things it writes to a developer's machine. Both live under
 * one cache directory so that "delete everything agentmeter put on my disk" is one `rm -rf` of a
 * directory the developer can see the name of.
 */
export function queueDirectory(cacheDir) {
    return join(cacheDir, "queue");
}
export function cursorPath(cacheDir) {
    return join(cacheDir, "scan-cursor.json");
}
