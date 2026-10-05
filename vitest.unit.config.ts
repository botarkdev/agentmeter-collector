import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/unit/**/*.unit.test.ts"],
    coverage: {
      provider: "v8",
      // TASKRAIL.md T104: declared explicitly so `text-summary` — the reporter
      // CI once copied into its run summary (that wrapper is gone since spec 0043; the block still
      // tells anyone reading a log what was covered) — is
      // present regardless of who runs this. Vitest 4 only adds it on its own when a coding
      // agent's environment variables are set (std-env's `isAgent`), and GitHub Actions sets
      // none of them; see docs/bugs/coverage-summary-only-under-an-agent.md. Keeps vitest's own
      // default four reporters and adds text-summary — nothing that depended on one of the four
      // (the `html` report an engineer opens locally, `clover`/`json` if anything reads them)
      // loses it.
      // `cobertura` is what scripts/coverage-summary.mjs reads to build the coverage table
      // .github/workflows/tests.yml publishes on the run page (spec 0043, FR-046): one
      // machine-readable file, coverage/cobertura-coverage.xml, per unit.
      reporter: ["text", "html", "clover", "json", "text-summary", "cobertura"],
      // Exclusion-based, deliberately, exactly as apps/api does it: measuring everything under
      // src/ and naming what is excluded means a directory added by a later spec is measured by
      // default, instead of silently escaping the gate the way an inclusion allowlist would let
      // it.
      include: ["src/**/*.ts"],
      exclude: [
        // Bootstrap file — Constitution VII: MUST NOT be tested. Two statements, no logic:
        // everything it does lives in src/cli/run-cli.ts, which is covered.
        "src/cli/agentmeter.ts",
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
      },
    },
  },
});
