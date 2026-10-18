import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

/**
 * Integration-level (spawns the real CLI entrypoint via tsx, mirroring how a user runs it)
 * rather than unit-level, since src/cli/index.ts's main() isn't exported for direct testing —
 * it's a thin wrapper whose only job is wiring parseCliArgs's thrown "requests"
 * (Help/VersionRequestedError) to console.log + exit 0, which parseCliArgs's own tests (see
 * args.test.ts) can't observe.
 */
const execFileAsync = promisify(execFile);
const PROJECT_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TSX_BIN = join(PROJECT_ROOT, "node_modules/.bin/tsx");
const CLI_ENTRY = join(PROJECT_ROOT, "src/cli/index.ts");

async function runCli(...args: string[]) {
  try {
    const { stdout, stderr } = await execFileAsync(TSX_BIN, [CLI_ENTRY, ...args]);
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const execError = error as { stdout: string; stderr: string; code: number };
    return { stdout: execError.stdout, stderr: execError.stderr, exitCode: execError.code };
  }
}

describe("tulip --version / -v", () => {
  // tsx's cold start (first-run TS transform) can exceed vitest's default 5s test timeout.
  const TSX_STARTUP_TIMEOUT = 20_000;

  it(
    "prints the version line and exits 0, like --help",
    async () => {
      const [versionResult, helpResult] = await Promise.all([
        runCli("--version"),
        runCli("--help"),
      ]);

      expect(versionResult.stdout.trim()).toMatch(/^Tulip \S+/);
      expect(versionResult.exitCode).toBe(0);
      expect(helpResult.exitCode).toBe(0); // same success shape --version mirrors
    },
    TSX_STARTUP_TIMEOUT,
  );

  it(
    "accepts the -v short flag too",
    async () => {
      const result = await runCli("-v");

      expect(result.stdout.trim()).toMatch(/^Tulip \S+/);
      expect(result.exitCode).toBe(0);
    },
    TSX_STARTUP_TIMEOUT,
  );

  it(
    "shows the dev fallback when run from source (no build-info.json next to src/version.ts)",
    async () => {
      const pkg = JSON.parse(await readFile(join(PROJECT_ROOT, "package.json"), "utf8"));
      const result = await runCli("--version");

      expect(result.stdout.trim()).toBe(`Tulip ${pkg.version} (dev)`);
    },
    TSX_STARTUP_TIMEOUT,
  );
});

/**
 * Dual-mode check, mirroring src/prompts/dist.test.ts's pattern: proves a real `node
 * dist/cli/index.js --version` (what a global install actually runs) prints the build-time
 * version, not the dev fallback above. Skipped when dist/ doesn't exist; the repo's required
 * flow is `pnpm build && pnpm test`, so this normally runs for real.
 */
const DIST_CLI_JS = join(PROJECT_ROOT, "dist/cli/index.js");
const builtDist = existsSync(DIST_CLI_JS);

describe.runIf(builtDist)("node dist/cli/index.js --version (after pnpm build)", () => {
  it("prints the real build version, not the dev fallback", async () => {
    const { stdout } = await execFileAsync("node", [DIST_CLI_JS, "--version"]);

    expect(stdout.trim()).toMatch(/^Tulip \d+\.\d+\.\d+ \([0-9a-f]+, built .+\)$/);
  });
});

describe.runIf(!builtDist)("node dist/cli/index.js --version (skipped — no build found)", () => {
  it("run `pnpm build` first to exercise the dist/ check above", () => {
    expect(builtDist).toBe(false);
  });
});
