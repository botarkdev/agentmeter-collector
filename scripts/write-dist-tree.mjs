// Writes the tree the `dist` branch holds: a packed release, unpacked, with the manifest reduced
// to what an installer needs.
//
// The branch exists so the collector can be installed straight from this repository
// (`github:botarkdev/agentmeter-collector#dist-v<version>`), and a package manager that installs
// from git gets whatever the ref holds — it builds nothing unless the manifest asks it to. So the
// ref holds the built package, and its manifest carries no `scripts` and no `devDependencies`:
// `prepack` would otherwise ask an older npm to build from sources that are not in this tree.
//
// Usage: node scripts/write-dist-tree.mjs <tarball> <empty target directory>
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [tarball, target] = process.argv.slice(2);
if (tarball === undefined || target === undefined) {
  console.error("usage: node scripts/write-dist-tree.mjs <tarball> <empty target directory>");
  process.exit(2);
}

const directory = resolve(target);
mkdirSync(directory, { recursive: true });
// `.git` is allowed: the release workflow unpacks into a checkout of the branch it has emptied.
const present = readdirSync(directory).filter((name) => name !== ".git");
if (present.length > 0) {
  console.error(`write-dist-tree: ${directory} is not empty`);
  process.exit(1);
}

execFileSync("tar", ["-xzf", resolve(tarball), "-C", directory, "--strip-components=1"]);

const manifestPath = join(directory, "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
delete manifest.scripts;
delete manifest.devDependencies;
delete manifest.packageManager;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`write-dist-tree: ${manifest.name} ${manifest.version} written to ${directory}`);
