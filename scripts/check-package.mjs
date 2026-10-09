// Packs the collector exactly as a release does and checks the result is the thing a user installs:
// the built entry points and nothing a user has no use for, installable with no build step and no
// network, with a binary that runs, under the licence its manifest declares.
//
// It is a check on the ARTEFACT, which the unit suite cannot see: that suite imports src/, and a
// package can pass every test there and still ship without its binary.
//
// Usage: node scripts/check-package.mjs   (after `pnpm build`; writes only to a temporary directory)
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const REQUIRED = [
  "package/package.json",
  "package/README.md",
  "package/LICENSE",
  "package/NOTICE",
  "package/dist/index.js",
  "package/dist/index.d.ts",
  "package/dist/cli/agentmeter.js",
];
// Sources, tests, the design record, the backlog and developer tooling: none of it runs on a
// user's machine.
const FORBIDDEN_PREFIXES = [
  "package/src/",
  "package/test/",
  "package/specs/",
  "package/scripts/",
  "package/.github/",
  "package/coverage/",
  "package/node_modules/",
  "package/docs/",
  "package/.taskrail/",
  "package/.claude/",
  "package/TASKRAIL.md",
];

// The licences this package may declare, each with the SHA-256 of its text exactly as its steward
// publishes it. `LICENSE` must be that text, byte for byte, for the identifier the manifest
// declares: a manifest and a licence file that disagree, and a licence file that was edited,
// reflowed or re-encoded, both fail here.
// Apache-2.0: https://www.apache.org/licenses/LICENSE-2.0.txt, 11358 bytes.
const LICENCE_TEXTS = {
  "Apache-2.0": "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
};
const COPYRIGHT_NOTICE = "Copyright 2026 Alexander Rondon";

const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};

// What a directory holding the package — an installed copy, or the `dist` tree — must say about
// its licence: the same three things, wherever a user got it from.
const checkLicence = (directory, where) => {
  const read = (name) => {
    try {
      return readFileSync(join(directory, name));
    } catch {
      check(false, `${where} has no ${name}`);
      return undefined;
    }
  };
  const packed = read("package.json");
  const licence = read("LICENSE");
  const notice = read("NOTICE");
  if (packed === undefined) return;
  const declared = JSON.parse(packed.toString("utf8")).license;
  check(
    declared === manifest.license,
    `${where} declares the licence ${JSON.stringify(declared)}, not ${JSON.stringify(manifest.license)}`,
  );
  const expected = typeof declared === "string" ? LICENCE_TEXTS[declared] : undefined;
  check(
    expected !== undefined,
    `${where} declares ${JSON.stringify(declared)}, which is no licence this check knows the text of`,
  );
  if (licence !== undefined && expected !== undefined) {
    check(
      createHash("sha256").update(licence).digest("hex") === expected,
      `${where}: LICENSE is not the published text of ${declared}`,
    );
  }
  if (notice !== undefined) {
    check(
      notice.toString("utf8").split("\n").includes(COPYRIGHT_NOTICE),
      `${where}: NOTICE does not carry the line "${COPYRIGHT_NOTICE}"`,
    );
  }
};

const work = mkdtempSync(join(tmpdir(), "agentmeter-package-"));
try {
  execFileSync("pnpm", ["pack", "--pack-destination", work], { cwd: root, stdio: "pipe" });
  const tarballs = readdirSync(work).filter((name) => name.endsWith(".tgz"));
  check(tarballs.length === 1, `expected one tarball, found ${tarballs.length}`);
  const tarball = join(work, tarballs[0] ?? "missing.tgz");

  const entries = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line.length > 0);
  for (const path of REQUIRED) {
    check(entries.includes(path), `the package is missing ${path}`);
  }
  for (const entry of entries) {
    const prefix = FORBIDDEN_PREFIXES.find((candidate) => entry.startsWith(candidate));
    check(prefix === undefined, `the package ships ${entry}`);
  }
  check(
    Object.keys(manifest.dependencies ?? {}).length === 0,
    "the package declares runtime dependencies; it must have none",
  );

  // Installed the way a user installs it: from the tarball alone, running no script. `--offline`
  // is the proof that it needs nothing else — with a runtime dependency this step cannot succeed.
  const consumer = join(work, "consumer");
  execFileSync("mkdir", ["-p", consumer]);
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ name: "consumer", private: true }),
  );
  execFileSync(
    "npm",
    ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", tarball],
    { cwd: consumer, stdio: "pipe" },
  );

  checkLicence(
    join(consumer, "node_modules", ...manifest.name.split("/")),
    "the installed package",
  );

  // The `dist` branch's tree is this same file, unpacked by the script the release runs. Nobody
  // installs it through this check, so what it holds of the licence is read here.
  const tree = join(work, "dist-tree");
  execFileSync(process.execPath, [join(root, "scripts", "write-dist-tree.mjs"), tarball, tree], {
    stdio: "pipe",
  });
  checkLicence(tree, "the dist tree");

  // With no endpoint and no token the binary must say so and exit 0: that is what a hook does in
  // every repository that has the package and has not been configured yet.
  const env = { ...process.env };
  delete env.AGENTMETER_ENDPOINT;
  delete env.AGENTMETER_TOKEN;
  const output = execFileSync(join(consumer, "node_modules", ".bin", "agentmeter"), ["push"], {
    cwd: consumer,
    env,
    encoding: "utf8",
  });
  check(output.includes("not configured"), `the installed binary printed: ${output.trim()}`);

  const imported = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import * as api from ${JSON.stringify(manifest.name)}; console.log(Object.keys(api).sort().join(","));`,
    ],
    { cwd: consumer, encoding: "utf8" },
  ).trim();
  for (const name of ["runCollector", "resolveConfigFromEnv", "runCli", "summarise"]) {
    check(imported.split(",").includes(name), `the installed package does not export ${name}`);
  }

  if (failures.length === 0) {
    console.log(`check-package: ok — ${tarballs[0]}, ${entries.length} files`);
  }
} catch (error) {
  failures.push(
    `a step failed: ${error instanceof Error ? error.message.split("\n")[0] : "unknown"}`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}

for (const failure of failures) {
  console.error(`check-package: ${failure}`);
}
process.exitCode = failures.length === 0 ? 0 : 1;
