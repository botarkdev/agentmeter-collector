// Removes dist/ before a build, so a file whose source was deleted or renamed cannot survive into
// the package. Its own script because `rm -rf` is not a command on every platform a contributor
// builds on.
import { rmSync } from "node:fs";

rmSync(new URL("../dist", import.meta.url), { recursive: true, force: true });
