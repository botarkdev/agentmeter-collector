import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/unit/**/*.unit.test.ts"],
    coverage: {
      provider: "v8",
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
