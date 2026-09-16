import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../config.js";
import { runCommand } from "./exec.js";
import { GIT_NO_PROMPT_ENV, gitCredentialArgs, wrapAuthFailure } from "./git-auth.js";
import type { PrRef } from "./pr-url.js";

/** Runs a `git` subcommand in `cwd` and returns its stdout. `env` is merged over the process's
 * own environment. Mockable in tests. */
export type GitRunner = (
  args: string[],
  cwd: string,
  env: Record<string, string>,
) => Promise<string>;

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

/** A full SHA-1 or SHA-256 object name. Revisions come from the PR's host, and are passed to git
 * as operands: anything else (an option-shaped string, say) is refused rather than handed to git. */
const COMMIT_SHA_PATTERN = /^([0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * Creates a local checkout containing just enough history to read any file at the PR's base or
 * head revision, with the head revision's working tree checked out (so a claude session's
 * Read/Grep/Glob tools see real files). Fetches both commits shallowly (depth {@link config}.limits
 * .checkoutFetchDepth) by SHA, so it works even when the base/head branches have since moved or
 * been deleted. The fetch authenticates with the operator's git credentials, `gh`, or
 * `GITHUB_TOKEN` (see git-auth.ts) and throws with a setup hint when none works.
 */
export async function createCheckout(
  pr: PrRef,
  revisions: { base: { sha: string }; head: { sha: string } },
  options: CreateCheckoutOptions = {},
): Promise<PrCheckout> {
  for (const sha of [revisions.base.sha, revisions.head.sha]) {
    if (!COMMIT_SHA_PATTERN.test(sha)) {
      throw new Error(`Not a commit SHA: ${JSON.stringify(sha)}`);
    }
  }
  const runGit = options.runGit ?? defaultRunGit;
  const removeDir = options.rm ?? defaultRm;
  const dir = await (options.mkdtemp ?? defaultMkdtemp)();
  const depth = String(config.limits.checkoutFetchDepth);

  const remoteUrl = `https://${pr.host}/${pr.owner}/${pr.repo}.git`;
  const runIsolated = (args: string[]) => runGit(args, dir, GIT_ISOLATION_ENV);
  const runFetch = (sha: string) =>
    runGit(
      [...gitCredentialArgs(pr.host), "fetch", "--depth", depth, "origin", sha],
      dir,
      GIT_NO_PROMPT_ENV,
    );
  try {
    await runIsolated(["init"]);
    await runIsolated(["remote", "add", "origin", remoteUrl]);
    // Both fetches run before anything is checked out, so the working tree is empty and fetch
    // interprets no PR content: no `.gitmodules` for `fetch.recurseSubmodules`, no attributes.
    // That is what makes running fetch with the operator's config safe — keep the order.
    await runFetch(revisions.base.sha);
    await runFetch(revisions.head.sha);
    await runIsolated(["checkout", revisions.head.sha]);
  } catch (error) {
    // None of the above succeeded enough to hand back a usable PrCheckout — the caller never
    // gets a `checkout` to call `.cleanup()` on, so this is the only chance to remove `dir`.
    await removeDir(dir);
    throw wrapAuthFailure(error, remoteUrl);
  }

  async function getFileAt(sha: string, path: string): Promise<string | undefined> {
    try {
      return await runIsolated(["show", `${sha}:${path}`]);
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
 * an untrusted PR's checkout, so a malicious PR's `.gitattributes` can't invoke an
 * operator-configured smudge/textconv filter or driver. Every step but `fetch` runs this way;
 * fetch needs the operator's config, since that is where credential helpers and `insteadOf`
 * rewrites live, and it interprets nothing from the PR (see the ordering note in createCheckout). */
const GIT_ISOLATION_ENV = { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };

async function defaultRunGit(
  args: string[],
  cwd: string,
  env: Record<string, string>,
): Promise<string> {
  return runCommand("git", args, { cwd, env });
}

async function defaultRm(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

async function defaultMkdtemp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "tulip-"));
}
