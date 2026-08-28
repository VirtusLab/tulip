import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
    // Builds the vendored highlight.js bundle on demand if `pnpm build` hasn't run yet — see
    // that script's comment for why this can't just be a beforeAll in the test that needs it.
    globalSetup: ["./scripts/vitest-global-setup.mjs"],
  },
});
