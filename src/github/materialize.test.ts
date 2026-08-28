import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileDiff, ParsedDiff } from "../diff/change.js";
import { createLogger } from "../logging/logger.js";
import { materializeChangeArtifacts } from "./materialize.js";

const RAW_DIFF = "diff --git a/src/a.ts b/src/a.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n";

/** A fake `PrCheckout` with in-memory base content, backed by a real temp dir for `dir` so
 * writes can be verified by actually reading them back — no filesystem mocking. */
function fakeCheckout(dir: string, baseContent: Record<string, string>) {
  return {
    dir,
    getFileAtBase: vi.fn(async (path: string) => baseContent[path]),
  };
}

function fileDiff(overrides: Partial<FileDiff>): FileDiff {
  return { path: "src/a.ts", status: "modified", binary: false, changes: [], ...overrides };
}

describe("materializeChangeArtifacts", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("writes the full raw diff verbatim to .tulip/pr.diff", async () => {
    dir = await mkdtemp(join(tmpdir(), "tulip-materialize-"));
    const checkout = fakeCheckout(dir, {});
    const diff: ParsedDiff = { files: [] };

    await materializeChangeArtifacts(checkout, diff, RAW_DIFF);

    await expect(readFile(join(dir, ".tulip", "pr.diff"), "utf8")).resolves.toBe(RAW_DIFF);
  });

  it("writes base content for a modified file under its own path", async () => {
    dir = await mkdtemp(join(tmpdir(), "tulip-materialize-"));
    const checkout = fakeCheckout(dir, { "src/a.ts": "old content\n" });
    const diff: ParsedDiff = { files: [fileDiff({ path: "src/a.ts", status: "modified" })] };

    await materializeChangeArtifacts(checkout, diff, RAW_DIFF);

    await expect(readFile(join(dir, ".tulip", "base", "src/a.ts"), "utf8")).resolves.toBe(
      "old content\n",
    );
  });

  it("writes base content for a removed file (path is already the base-side path)", async () => {
    dir = await mkdtemp(join(tmpdir(), "tulip-materialize-"));
    const checkout = fakeCheckout(dir, { "src/gone.ts": "gone content\n" });
    const diff: ParsedDiff = { files: [fileDiff({ path: "src/gone.ts", status: "removed" })] };

    await materializeChangeArtifacts(checkout, diff, RAW_DIFF);

    await expect(readFile(join(dir, ".tulip", "base", "src/gone.ts"), "utf8")).resolves.toBe(
      "gone content\n",
    );
  });

  it("writes a renamed file's base content under its previous (base-side) path", async () => {
    dir = await mkdtemp(join(tmpdir(), "tulip-materialize-"));
    const checkout = fakeCheckout(dir, { "old/name.ts": "renamed base content\n" });
    const diff: ParsedDiff = {
      files: [fileDiff({ path: "new/name.ts", previousPath: "old/name.ts", status: "renamed" })],
    };

    await materializeChangeArtifacts(checkout, diff, RAW_DIFF);

    await expect(readFile(join(dir, ".tulip", "base", "old", "name.ts"), "utf8")).resolves.toBe(
      "renamed base content\n",
    );
    await expect(readFile(join(dir, ".tulip", "base", "new", "name.ts"), "utf8")).rejects.toThrow();
  });

  it("does not write a base file for an added file", async () => {
    dir = await mkdtemp(join(tmpdir(), "tulip-materialize-"));
    const checkout = fakeCheckout(dir, {});
    const diff: ParsedDiff = { files: [fileDiff({ path: "src/new.ts", status: "added" })] };

    await materializeChangeArtifacts(checkout, diff, RAW_DIFF);

    await expect(checkout.getFileAtBase).not.toHaveBeenCalled();
    await expect(readFile(join(dir, ".tulip", "base", "src/new.ts"), "utf8")).rejects.toThrow();
  });

  it("skips binary files entirely", async () => {
    dir = await mkdtemp(join(tmpdir(), "tulip-materialize-"));
    const checkout = fakeCheckout(dir, { "image.png": "would-be binary content" });
    const diff: ParsedDiff = {
      files: [fileDiff({ path: "image.png", status: "modified", binary: true })],
    };

    await materializeChangeArtifacts(checkout, diff, RAW_DIFF);

    expect(checkout.getFileAtBase).not.toHaveBeenCalled();
    await expect(readFile(join(dir, ".tulip", "base", "image.png"), "utf8")).rejects.toThrow();
  });

  it("preserves nested subdirectory structure under .tulip/base", async () => {
    dir = await mkdtemp(join(tmpdir(), "tulip-materialize-"));
    const checkout = fakeCheckout(dir, { "src/deep/nested/file.ts": "nested content\n" });
    const diff: ParsedDiff = {
      files: [fileDiff({ path: "src/deep/nested/file.ts", status: "modified" })],
    };

    await materializeChangeArtifacts(checkout, diff, RAW_DIFF);

    await expect(
      readFile(join(dir, ".tulip", "base", "src", "deep", "nested", "file.ts"), "utf8"),
    ).resolves.toBe("nested content\n");
  });

  it("skips a file when its base content is undefined (not present at base)", async () => {
    dir = await mkdtemp(join(tmpdir(), "tulip-materialize-"));
    const checkout = fakeCheckout(dir, {});
    const diff: ParsedDiff = { files: [fileDiff({ path: "src/a.ts", status: "modified" })] };

    await materializeChangeArtifacts(checkout, diff, RAW_DIFF);

    await expect(readFile(join(dir, ".tulip", "base", "src/a.ts"), "utf8")).rejects.toThrow();
  });

  it("refuses to follow a tracked .tulip symlink escaping the checkout, and writes fresh instead", async () => {
    dir = await mkdtemp(join(tmpdir(), "tulip-materialize-"));
    // Simulates a malicious PR whose head checkout contains a tracked symlink at `.tulip`
    // (`git checkout` recreates tracked symlinks verbatim) pointing outside the checkout.
    const escapeDir = await mkdtemp(join(tmpdir(), "tulip-escape-"));
    await symlink(escapeDir, join(dir, ".tulip"));
    const checkout = fakeCheckout(dir, {});
    const diff: ParsedDiff = { files: [] };

    try {
      await materializeChangeArtifacts(checkout, diff, RAW_DIFF);

      // The escape target is never written into — the symlink itself was removed, not followed.
      await expect(readdir(escapeDir)).resolves.toEqual([]);
      // .tulip is now a real, self-owned directory inside the checkout.
      const stats = await lstat(join(dir, ".tulip"));
      expect(stats.isSymbolicLink()).toBe(false);
      await expect(readFile(join(dir, ".tulip", "pr.diff"), "utf8")).resolves.toBe(RAW_DIFF);
    } finally {
      await rm(escapeDir, { recursive: true, force: true });
    }
  });

  it("clears stale/planted content from a pre-existing .tulip before writing", async () => {
    dir = await mkdtemp(join(tmpdir(), "tulip-materialize-"));
    // Simulates a PR that itself commits a `.tulip/base/decoy.txt` — without clearing first,
    // this forged "base content" would survive materialization and could spoof the LLM.
    await mkdir(join(dir, ".tulip", "base"), { recursive: true });
    await writeFile(
      join(dir, ".tulip", "base", "decoy.txt"),
      "forged pre-change content\n",
      "utf8",
    );
    const checkout = fakeCheckout(dir, {});
    const diff: ParsedDiff = { files: [] };

    await materializeChangeArtifacts(checkout, diff, RAW_DIFF);

    await expect(readFile(join(dir, ".tulip", "base", "decoy.txt"), "utf8")).rejects.toThrow();
  });

  it("materializes a base file whose path merely starts with '..' (not a traversal segment)", async () => {
    dir = await mkdtemp(join(tmpdir(), "tulip-materialize-"));
    const checkout = fakeCheckout(dir, { "..foo/bar.ts": "dotdot-prefixed path content\n" });
    const diff: ParsedDiff = { files: [fileDiff({ path: "..foo/bar.ts", status: "modified" })] };

    await materializeChangeArtifacts(checkout, diff, RAW_DIFF);

    await expect(readFile(join(dir, ".tulip", "base", "..foo", "bar.ts"), "utf8")).resolves.toBe(
      "dotdot-prefixed path content\n",
    );
  });

  it("refuses to write a base file for a path with a real traversal segment", async () => {
    dir = await mkdtemp(join(tmpdir(), "tulip-materialize-"));
    const checkout = fakeCheckout(dir, { "../escape.txt": "should never be read" });
    const diff: ParsedDiff = { files: [fileDiff({ path: "../escape.txt", status: "modified" })] };

    await materializeChangeArtifacts(checkout, diff, RAW_DIFF);

    expect(checkout.getFileAtBase).not.toHaveBeenCalled();
    await expect(readFile(join(dir, ".tulip", "escape.txt"), "utf8")).rejects.toThrow();
  });

  it("continues materializing other files, and logs a warning, when one file's base fetch fails", async () => {
    dir = await mkdtemp(join(tmpdir(), "tulip-materialize-"));
    const checkout = fakeCheckout(dir, {});
    checkout.getFileAtBase.mockImplementation(async (path: string) => {
      if (path === "src/bad.ts") throw new Error("simulated fs failure");
      return path === "src/good.ts" ? "good content\n" : undefined;
    });
    const diff: ParsedDiff = {
      files: [
        fileDiff({ path: "src/bad.ts", status: "modified" }),
        fileDiff({ path: "src/good.ts", status: "modified" }),
      ],
    };
    const write = vi.fn();
    const logger = createLogger({ write });

    await materializeChangeArtifacts(checkout, diff, RAW_DIFF, { logger });

    await expect(readFile(join(dir, ".tulip", "base", "src/good.ts"), "utf8")).resolves.toBe(
      "good content\n",
    );
    await expect(readFile(join(dir, ".tulip", "base", "src/bad.ts"), "utf8")).rejects.toThrow();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toMatch(/warning.*src\/bad\.ts.*simulated fs failure/);
  });
});
