import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { PrRef } from "./pr-url.js";

const execFileAsync = promisify(execFile);

/** Runs a `git` subcommand in `cwd` and returns its stdout. Mockable in tests. */
export type GitRunner = (args: string[], cwd: string) => Promise<string>;

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
}

/**
 * Creates a bare-ish local checkout containing just enough history to read any file at
 * the PR's base or head revision. Fetches both commits shallowly (depth 1) by SHA, so it
 * works even when the base/head branches have since moved or been deleted.
 */
export async function createCheckout(
  pr: PrRef,
  revisions: { base: { sha: string }; head: { sha: string } },
  options: CreateCheckoutOptions = {},
): Promise<PrCheckout> {
  const runGit = options.runGit ?? defaultRunGit;
  const dir = await (options.mkdtemp ?? defaultMkdtemp)();

  const remoteUrl = `https://github.com/${pr.owner}/${pr.repo}.git`;
  await runGit(["init"], dir);
  await runGit(["remote", "add", "origin", remoteUrl], dir);
  await runGit(["fetch", "--depth", "1", "origin", revisions.base.sha], dir);
  await runGit(["fetch", "--depth", "1", "origin", revisions.head.sha], dir);

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
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

async function defaultRunGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

async function defaultMkdtemp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "tulip-"));
}
