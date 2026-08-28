import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../config.js";
import { runCommand } from "./exec.js";
import type { PrRef } from "./pr-url.js";

/** Runs a `git` subcommand in `cwd` and returns its stdout. Mockable in tests. */
export type GitRunner = (args: string[], cwd: string) => Promise<string>;

/** Removes a directory recursively. Mockable in tests. */
export type DirRemover = (dir: string) => Promise<void>;

/** A shallow local clone giving access to file contents at both the PR's base and head revisions. */
export interface PrCheckout {
  /** Absolute path to the checkout directory. */
  readonly dir: string;
  /** File content at the PR's base revision, or undefined if the path doesn't exist there. */
  getFileAtBase(path: string): Promise<string | undefined>;
  /** File content at the PR's head revision, or undefined if the path doesn't exist there. */
  getFileAtHead(path: string): Promise<string | undefined>;
  /** Deletes the checkout directory. */
  cleanup(): Promise<void>;
}

export interface CreateCheckoutOptions {
  /** Defaults to invoking the `git` binary on PATH. */
  runGit?: GitRunner;
  /** Defaults to a fresh directory under the OS temp dir. */
  mkdtemp?: () => Promise<string>;
  /** Defaults to `fs.rm(dir, { recursive: true, force: true })`. */
  rm?: DirRemover;
}

/**
 * Creates a local checkout containing just enough history to read any file at the PR's base or
 * head revision, with the head revision's working tree checked out (so a claude session's
 * Read/Grep/Glob tools see real files). Fetches both commits shallowly (depth {@link config}.limits
 * .checkoutFetchDepth) by SHA, so it works even when the base/head branches have since moved or
 * been deleted.
 */
export async function createCheckout(
  pr: PrRef,
  revisions: { base: { sha: string }; head: { sha: string } },
  options: CreateCheckoutOptions = {},
): Promise<PrCheckout> {
  const runGit = options.runGit ?? defaultRunGit;
  const removeDir = options.rm ?? defaultRm;
  const dir = await (options.mkdtemp ?? defaultMkdtemp)();
  const depth = String(config.limits.checkoutFetchDepth);

  const remoteUrl = `https://github.com/${pr.owner}/${pr.repo}.git`;
  try {
    await runGit(["init"], dir);
    await runGit(["remote", "add", "origin", remoteUrl], dir);
    await runGit(["fetch", "--depth", depth, "origin", revisions.base.sha], dir);
    await runGit(["fetch", "--depth", depth, "origin", revisions.head.sha], dir);
    await runGit(["checkout", revisions.head.sha], dir);
  } catch (error) {
    // None of the above succeeded enough to hand back a usable PrCheckout — the caller never
    // gets a `checkout` to call `.cleanup()` on, so this is the only chance to remove `dir`.
    await removeDir(dir);
    throw error;
  }

  async function getFileAt(sha: string, path: string): Promise<string | undefined> {
    try {
      return await runGit(["show", `${sha}:${path}`], dir);
    } catch {
      return undefined;
    }
  }

  return {
    dir,
    getFileAtBase: (path) => getFileAt(revisions.base.sha, path),
    getFileAtHead: (path) => getFileAt(revisions.head.sha, path),
    cleanup: () => removeDir(dir),
  };
}

/** Isolates `git` from the operator's own `~/.gitconfig` and system config while it operates on
 * an untrusted PR's checkout — e.g. so a malicious PR's `.gitattributes` can't invoke an
 * operator-configured smudge/textconv filter/driver during fetch or checkout. */
const GIT_ISOLATION_ENV = { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };

async function defaultRunGit(args: string[], cwd: string): Promise<string> {
  return runCommand("git", args, { cwd, env: GIT_ISOLATION_ENV });
}

async function defaultRm(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

async function defaultMkdtemp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "tulip-"));
}
