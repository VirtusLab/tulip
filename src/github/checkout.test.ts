import { execFile } from "node:child_process";
import { readFile, mkdtemp as realMkdtemp, rm as realRm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "../config.js";
import { createCheckout } from "./checkout.js";
import type { PrRef } from "./pr-url.js";

const PR: PrRef = { owner: "owner", repo: "repo", number: 1 };
const REVISIONS = { base: { sha: "base-sha" }, head: { sha: "head-sha" } };
const DEPTH = String(config.limits.checkoutFetchDepth);

describe("createCheckout", () => {
  it("inits a repo, adds the origin remote, shallow-fetches both revisions, and checks out head", async () => {
    const runGit = vi.fn(async () => "");
    const mkdtemp = vi.fn(async () => "/tmp/tulip-abc123");

    await createCheckout(PR, REVISIONS, { runGit, mkdtemp });

    const dir = "/tmp/tulip-abc123";
    expect(runGit).toHaveBeenNthCalledWith(1, ["init"], dir);
    expect(runGit).toHaveBeenNthCalledWith(
      2,
      ["remote", "add", "origin", "https://github.com/owner/repo.git"],
      dir,
    );
    expect(runGit).toHaveBeenNthCalledWith(
      3,
      ["fetch", "--depth", DEPTH, "origin", "base-sha"],
      dir,
    );
    expect(runGit).toHaveBeenNthCalledWith(
      4,
      ["fetch", "--depth", DEPTH, "origin", "head-sha"],
      dir,
    );
    expect(runGit).toHaveBeenNthCalledWith(5, ["checkout", "head-sha"], dir);
  });

  it("reads file content at base and head via git show", async () => {
    const runGit = vi.fn(async (args: string[]) => {
      if (args[0] === "show" && args[1] === "base-sha:src/a.ts") return "base content";
      if (args[0] === "show" && args[1] === "head-sha:src/a.ts") return "head content";
      return "";
    });
    const checkout = await createCheckout(PR, REVISIONS, {
      runGit,
      mkdtemp: async () => "/tmp/tulip-abc123",
    });

    await expect(checkout.getFileAtBase("src/a.ts")).resolves.toBe("base content");
    await expect(checkout.getFileAtHead("src/a.ts")).resolves.toBe("head content");
  });

  it("returns undefined when the file doesn't exist at that revision", async () => {
    const runGit = vi.fn(async (args: string[]) => {
      if (args[0] === "show") throw new Error("fatal: path does not exist");
      return "";
    });
    const checkout = await createCheckout(PR, REVISIONS, {
      runGit,
      mkdtemp: async () => "/tmp/tulip-abc123",
    });

    await expect(checkout.getFileAtBase("missing.ts")).resolves.toBeUndefined();
  });

  it("removes the temp dir and rethrows if a git step fails before the checkout is usable", async () => {
    const dir = "/tmp/tulip-abc123";
    const failure = new Error("fatal: could not fetch head sha");
    const runGit = vi.fn(async (args: string[]) => {
      if (args[0] === "fetch" && args.at(-1) === "head-sha") throw failure;
      return "";
    });
    const rm = vi.fn(async () => {});

    await expect(
      createCheckout(PR, REVISIONS, { runGit, mkdtemp: async () => dir, rm }),
    ).rejects.toThrow(failure);

    expect(rm).toHaveBeenCalledTimes(1);
    expect(rm).toHaveBeenCalledWith(dir);
  });

  it("cleanup removes exactly the checkout directory", async () => {
    const runGit = vi.fn(async () => "");
    const rm = vi.fn(async () => {});
    const dir = "/tmp/tulip-abc123";
    const checkout = await createCheckout(PR, REVISIONS, {
      runGit,
      mkdtemp: async () => dir,
      rm,
    });

    await checkout.cleanup();

    expect(rm).toHaveBeenCalledTimes(1);
    expect(rm).toHaveBeenCalledWith(dir);
  });
});

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

/** Builds a local, throwaway git repo with two commits, so createCheckout's real git flow can
 * be exercised end-to-end (real `git`, not a mocked `runGit`) without touching the network.
 * Returns the repo's dir and both commits' SHAs. */
async function createFixtureRepo(): Promise<{ dir: string; baseSha: string; headSha: string }> {
  const dir = await realMkdtemp(join(tmpdir(), "tulip-fixture-"));
  await git(["init", "-q"], dir);
  await git(["config", "user.email", "test@example.com"], dir);
  await git(["config", "user.name", "Test"], dir);
  await writeFile(join(dir, "a.txt"), "base content\n");
  await git(["add", "a.txt"], dir);
  await git(["commit", "-q", "-m", "base"], dir);
  const baseSha = await git(["rev-parse", "HEAD"], dir);
  await writeFile(join(dir, "a.txt"), "head content\n");
  await writeFile(join(dir, "b.txt"), "new file\n");
  await git(["add", "-A"], dir);
  await git(["commit", "-q", "-m", "head"], dir);
  const headSha = await git(["rev-parse", "HEAD"], dir);
  return { dir, baseSha, headSha };
}

describe("createCheckout (hermetic: real git against a local fixture repo, no network)", () => {
  let fixtureDir: string | undefined;
  let checkoutDir: string | undefined;

  afterEach(async () => {
    if (fixtureDir) await realRm(fixtureDir, { recursive: true, force: true });
    if (checkoutDir) await realRm(checkoutDir, { recursive: true, force: true });
    fixtureDir = undefined;
    checkoutDir = undefined;
  });

  it("checks out the head revision's actual working tree", async () => {
    const fixture = await createFixtureRepo();
    fixtureDir = fixture.dir;

    // Runs real git, but redirects the `origin` remote to the local fixture repo instead of
    // github.com — fetch then uses the filesystem transport, so no network access happens.
    const runGit = async (args: string[], cwd: string): Promise<string> => {
      const rewritten = args.map((arg) =>
        arg === `https://github.com/${PR.owner}/${PR.repo}.git` ? fixture.dir : arg,
      );
      return git(rewritten, cwd);
    };

    const checkout = await createCheckout(
      PR,
      { base: { sha: fixture.baseSha }, head: { sha: fixture.headSha } },
      { runGit },
    );
    checkoutDir = checkout.dir;

    await expect(readFile(join(checkout.dir, "a.txt"), "utf8")).resolves.toBe("head content\n");
    await expect(readFile(join(checkout.dir, "b.txt"), "utf8")).resolves.toBe("new file\n");

    await checkout.cleanup();
    checkoutDir = undefined;
  });
});
