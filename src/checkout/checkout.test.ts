import { execFile } from "node:child_process";
import { readFile, mkdtemp as realMkdtemp, rm as realRm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "../config.js";
import { type CheckoutAuth, createCheckout } from "./checkout.js";

const REPO = { host: "github.com", repoPath: "owner/repo" };
const BASE_SHA = "1".repeat(40);
const HEAD_SHA = "2".repeat(40);
const REVISIONS = { base: { sha: BASE_SHA }, head: { sha: HEAD_SHA } };
const DEPTH = String(config.limits.checkoutFetchDepth);

const ISOLATION_ENV = { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
const NO_PROMPT_ENV = { GIT_TERMINAL_PROMPT: "0" };
const AUTH: CheckoutAuth = { credentialHelpers: ["fake"], authHint: "run fake-login." };
const CREDENTIAL_ARGS = ["-c", "credential.https://github.com.helper=fake"];

describe("createCheckout", () => {
  it("inits a repo, adds the origin remote, shallow-fetches both revisions, and checks out head", async () => {
    const runGit = vi.fn(async () => "");
    const mkdtemp = vi.fn(async () => "/tmp/tulip-abc123");

    await createCheckout(REPO, REVISIONS, AUTH, { runGit, mkdtemp });

    // init/remote/checkout run isolated from the operator's git config; fetch runs with it (that's
    // where credential helpers live), with Tulip's helpers appended, and never prompts on the tty.
    const dir = "/tmp/tulip-abc123";
    expect(runGit).toHaveBeenNthCalledWith(1, ["init"], dir, ISOLATION_ENV);
    expect(runGit).toHaveBeenNthCalledWith(
      2,
      ["remote", "add", "origin", "https://github.com/owner/repo.git"],
      dir,
      ISOLATION_ENV,
    );
    expect(runGit).toHaveBeenNthCalledWith(
      3,
      [...CREDENTIAL_ARGS, "fetch", "--depth", DEPTH, "origin", BASE_SHA],
      dir,
      NO_PROMPT_ENV,
    );
    expect(runGit).toHaveBeenNthCalledWith(
      4,
      [...CREDENTIAL_ARGS, "fetch", "--depth", DEPTH, "origin", HEAD_SHA],
      dir,
      NO_PROMPT_ENV,
    );
    expect(runGit).toHaveBeenNthCalledWith(5, ["checkout", HEAD_SHA], dir, ISOLATION_ENV);
  });

  it("rejects revisions that are not commit SHAs before touching git or the filesystem", async () => {
    const runGit = vi.fn(async () => "");
    const mkdtemp = vi.fn(async () => "/tmp/t");

    await expect(
      createCheckout(REPO, { base: { sha: "--upload-pack=evil" }, head: { sha: HEAD_SHA } }, AUTH, {
        runGit,
        mkdtemp,
      }),
    ).rejects.toThrow(/not a commit SHA/i);

    expect(runGit).not.toHaveBeenCalled();
    expect(mkdtemp).not.toHaveBeenCalled();
  });

  it("explains how to authenticate when fetch fails for lack of credentials", async () => {
    const dir = "/tmp/tulip-abc123";
    const runGit = vi.fn(async (args: string[]) => {
      if (args.includes("fetch")) {
        throw new Error(
          "Command failed: git fetch\nfatal: could not read Username for 'https://github.com': terminal prompts disabled",
        );
      }
      return "";
    });
    const rm = vi.fn(async () => {});

    const error: Error = await createCheckout(REPO, REVISIONS, AUTH, {
      runGit,
      mkdtemp: async () => dir,
      rm,
    }).catch((e) => e);

    expect(error.message).toMatch(
      /git could not authenticate to https:\/\/github\.com\/owner\/repo\.git.*run fake-login\..*could not read Username/s,
    );
    // execFile's "Command failed: <argv>" line would bury the hint under the helper snippets.
    expect(error.message).not.toContain("Command failed");
    expect(rm).toHaveBeenCalledWith(dir);
  });

  it("reads file content at base and head via git show", async () => {
    const runGit = vi.fn(async (args: string[]) => {
      if (args[0] === "show" && args[1] === `${BASE_SHA}:src/a.ts`) return "base content";
      if (args[0] === "show" && args[1] === `${HEAD_SHA}:src/a.ts`) return "head content";
      return "";
    });
    const checkout = await createCheckout(REPO, REVISIONS, AUTH, {
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
    const checkout = await createCheckout(REPO, REVISIONS, AUTH, {
      runGit,
      mkdtemp: async () => "/tmp/tulip-abc123",
    });

    await expect(checkout.getFileAtBase("missing.ts")).resolves.toBeUndefined();
  });

  it("removes the temp dir and rethrows a non-auth failure unchanged", async () => {
    const dir = "/tmp/tulip-abc123";
    const failure = new Error("fatal: unable to access: Could not resolve host");
    const runGit = vi.fn(async (args: string[]) => {
      if (args.includes("fetch") && args.at(-1) === HEAD_SHA) throw failure;
      return "";
    });
    const rm = vi.fn(async () => {});

    await expect(
      createCheckout(REPO, REVISIONS, AUTH, { runGit, mkdtemp: async () => dir, rm }),
    ).rejects.toBe(failure);

    expect(rm).toHaveBeenCalledTimes(1);
    expect(rm).toHaveBeenCalledWith(dir);
  });

  it("cleanup removes exactly the checkout directory", async () => {
    const runGit = vi.fn(async () => "");
    const rm = vi.fn(async () => {});
    const dir = "/tmp/tulip-abc123";
    const checkout = await createCheckout(REPO, REVISIONS, AUTH, {
      runGit,
      mkdtemp: async () => dir,
      rm,
    });

    await checkout.cleanup();

    expect(rm).toHaveBeenCalledTimes(1);
    expect(rm).toHaveBeenCalledWith(dir);
  });

  it("clones a GitLab project by its nested path", async () => {
    const runGit = vi.fn(async () => "");
    const repo = { host: "git.example.com", repoPath: "group/sub/project" };

    await createCheckout(repo, REVISIONS, AUTH, { runGit, mkdtemp: async () => "/tmp/t" });

    expect(runGit).toHaveBeenNthCalledWith(
      2,
      ["remote", "add", "origin", "https://git.example.com/group/sub/project.git"],
      "/tmp/t",
      ISOLATION_ENV,
    );
  });
});

const execFileAsync = promisify(execFile);
const { GIT_CONFIG_PARAMETERS: _, ...processEnv } = process.env;

/** Runs real git, ignoring the developer's command-line config and askpass programs. */
async function git(args: string[], cwd: string, env?: Record<string, string>): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env: { ...processEnv, GIT_CONFIG_COUNT: "0", GIT_ASKPASS: "", SSH_ASKPASS: "", ...env },
  });
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

    // Runs real git with the env createCheckout chooses per step, but redirects the `origin`
    // remote to the local fixture repo instead of github.com — fetch then uses the filesystem
    // transport, so no network access happens.
    const runGit = async (
      args: string[],
      cwd: string,
      env: Record<string, string>,
    ): Promise<string> => {
      const rewritten = args.map((arg) =>
        arg === `https://github.com/${REPO.repoPath}.git` ? fixture.dir : arg,
      );
      return git(rewritten, cwd, env);
    };

    const checkout = await createCheckout(
      REPO,
      { base: { sha: fixture.baseSha }, head: { sha: fixture.headSha } },
      AUTH,
      { runGit },
    );
    checkoutDir = checkout.dir;

    await expect(readFile(join(checkout.dir, "a.txt"), "utf8")).resolves.toBe("head content\n");
    await expect(readFile(join(checkout.dir, "b.txt"), "utf8")).resolves.toBe("new file\n");

    await checkout.cleanup();
    checkoutDir = undefined;
  });
});
