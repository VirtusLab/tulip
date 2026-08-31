import * as fs from "node:fs";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

import { formatVersion, getBuildInfo } from "./version.js";

describe("getBuildInfo", () => {
  it("reads dist/build-info.json when present", () => {
    vi.mocked(fs.readFileSync).mockImplementationOnce(() =>
      JSON.stringify({
        version: "1.2.3",
        commitSha: "abc1234",
        buildDate: "2026-01-01T00:00:00.000Z",
      }),
    );

    expect(getBuildInfo()).toEqual({
      version: "1.2.3",
      commitSha: "abc1234",
      buildDate: "2026-01-01T00:00:00.000Z",
    });
  });

  it("falls back to package.json's version (with sha 'dev') when build-info.json is missing", () => {
    vi.mocked(fs.readFileSync).mockImplementationOnce(() => {
      throw new Error("ENOENT: no such file or directory");
    });

    const info = getBuildInfo();

    expect(info.commitSha).toBe("dev");
    expect(info.buildDate).toBe("unknown");
    expect(info.version).toMatch(/^\d+\.\d+\.\d+$/); // reads the real package.json
  });

  it("never throws, even if the package.json fallback read also fails", () => {
    const alwaysThrow = () => {
      throw new Error("nope");
    };
    // One-shot per readFileSync call (build-info.json, then the package.json fallback) — not a
    // persistent mockImplementation, which would leak into later tests/imports in this file
    // (e.g. the compiled dist/version.js, loaded dynamically below) that expect a real fs.
    vi.mocked(fs.readFileSync)
      .mockImplementationOnce(alwaysThrow)
      .mockImplementationOnce(alwaysThrow);

    let info: ReturnType<typeof getBuildInfo> | undefined;
    expect(() => {
      info = getBuildInfo();
    }).not.toThrow();
    expect(info).toEqual({ version: "0.0.0", commitSha: "dev", buildDate: "unknown" });
  });
});

describe("formatVersion", () => {
  it("formats a full build-info line", () => {
    expect(
      formatVersion({
        version: "1.2.3",
        commitSha: "abc1234",
        buildDate: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe("Tulip 1.2.3 (abc1234, built 2026-01-01T00:00:00.000Z)");
  });

  it("formats the dev fallback without a commit/date", () => {
    expect(formatVersion({ version: "0.1.0", commitSha: "dev", buildDate: "unknown" })).toBe(
      "Tulip 0.1.0 (dev)",
    );
  });
});

/**
 * Dual-mode check, mirroring src/prompts/dist.test.ts's pattern: proves `pnpm build` actually
 * produces dist/build-info.json next to the compiled dist/version.js, and that the compiled
 * getBuildInfo() reads it (the CLI's own `--version` output is covered separately, in
 * src/cli/index.test.ts). Skipped when dist/ doesn't exist (e.g. running tests without building
 * first); the repo's required flow is `pnpm build && pnpm test`, so this normally runs for real.
 */
const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST_VERSION_JS = join(PROJECT_ROOT, "dist/version.js");
const DIST_BUILD_INFO_JSON = join(PROJECT_ROOT, "dist/build-info.json");
const builtDist = existsSync(DIST_VERSION_JS);

describe.runIf(builtDist)("build-info.json (after pnpm build)", () => {
  it("exists with version/commitSha/buildDate", async () => {
    const buildInfo = JSON.parse(await readFile(DIST_BUILD_INFO_JSON, "utf8"));

    expect(buildInfo).toEqual({
      version: expect.any(String),
      commitSha: expect.any(String),
      buildDate: expect.any(String),
    });
  });

  it("resolves and reads it from the compiled dist/version.js", async () => {
    const { getBuildInfo: distGetBuildInfo } = await import(DIST_VERSION_JS);

    expect(distGetBuildInfo().commitSha).not.toBe("dev");
  });
});

describe.runIf(!builtDist)("build-info.json (skipped — no build found)", () => {
  it("run `pnpm build` first to exercise the dist/ checks above", () => {
    expect(builtDist).toBe(false);
  });
});
