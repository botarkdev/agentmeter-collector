import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/unit/**/*.unit.test.ts"],
    coverage: {
      provider: "v8",
      // `text-summary` is declared explicitly: Vitest 4 only adds it on its own when a coding
      // agent's environment variables are set, and GitHub Actions sets none of them, so a CI log
      // would otherwise show no coverage summary. Vitest's own default four reporters are kept.
      reporter: ["text", "html", "clover", "json", "text-summary"],
      // Exclusion-based, deliberately: measuring everything under src/ and naming what is
      // excluded means a directory added later is measured by default, instead of silently
      // escaping the gate the way an inclusion allowlist would let it.
      include: ["src/**/*.ts"],
      exclude: [
        // Bootstrap file, not to be tested. Two statements, no logic:
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
