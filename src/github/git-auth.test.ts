import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { gitCredentialArgs } from "./git-auth.js";

const execFileAsync = promisify(execFile);

/** Asks real git for credentials for `host`, with `gitCredentialArgs(scopedTo)` as the only helpers
 * in scope: the operator's config is switched off and cwd holds no repo. Resolves with git's answer,
 * rejects when no helper answered. No network. */
async function credentialFill(
  scopedTo: string,
  host: string,
  token: string | undefined,
): Promise<string> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  };
  if (token === undefined) {
    delete env.GITHUB_TOKEN;
  } else {
    env.GITHUB_TOKEN = token;
  }
  const child = execFileAsync("git", [...gitCredentialArgs(scopedTo), "credential", "fill"], {
    cwd: tmpdir(),
    env,
  });
  child.child.stdin?.end(`protocol=https\nhost=${host}\n\n`);
  return (await child).stdout;
}

describe("gitCredentialArgs (real git, no network)", () => {
  // A host `gh` is not logged into, so its helper stays silent and the token helper is what answers.
  const HOST = "git.example.test";

  it("answers with GITHUB_TOKEN for the PR's host", async () => {
    const out = await credentialFill(HOST, HOST, "ghp_secret");

    expect(out).toContain("username=x-access-token\n");
    expect(out).toContain("password=ghp_secret\n");
  });

  it("does not hand the token to any other host", async () => {
    await expect(credentialFill(HOST, "other.example.test", "ghp_secret")).rejects.toThrow(
      /could not read Username/,
    );
  });

  it("stays silent when GITHUB_TOKEN is unset", async () => {
    await expect(credentialFill(HOST, HOST, undefined)).rejects.toThrow(/could not read Username/);
  });
});
