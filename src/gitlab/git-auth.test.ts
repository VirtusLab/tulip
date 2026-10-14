import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { GITLAB_GIT_AUTH_HINT, gitCredentialArgs } from "./git-auth.js";

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
    delete env.GITLAB_TOKEN;
  } else {
    env.GITLAB_TOKEN = token;
  }
  const child = execFileAsync("git", [...gitCredentialArgs(scopedTo), "credential", "fill"], {
    cwd: tmpdir(),
    env,
  });
  child.child.stdin?.end(`protocol=https\nhost=${host}\n\n`);
  return (await child).stdout;
}

describe("GitLab gitCredentialArgs (real git, no network)", () => {
  const HOST = "git.example.test";

  it("answers with oauth2 and GITLAB_TOKEN for the MR's host", async () => {
    const out = await credentialFill(HOST, HOST, "glpat-secret");

    expect(out).toContain("username=oauth2\n");
    expect(out).toContain("password=glpat-secret\n");
  });

  it("passes a token with shell and printf metacharacters through verbatim", async () => {
    const token = "a%s b'\"$x`y\\z";

    const out = await credentialFill(HOST, HOST, token);

    expect(out).toContain(`password=${token}\n`);
  });

  it("does not hand the token to any other host", async () => {
    await expect(credentialFill(HOST, "other.example.test", "glpat-secret")).rejects.toThrow(
      /could not read Username/,
    );
  });

  it.each([undefined, ""])("stays silent when GITLAB_TOKEN is %j", async (token) => {
    await expect(credentialFill(HOST, HOST, token)).rejects.toThrow(/could not read Username/);
  });
});

describe("GITLAB_GIT_AUTH_HINT", () => {
  it("names GITLAB_TOKEN and the scope git needs", () => {
    expect(GITLAB_GIT_AUTH_HINT).toMatch(/GITLAB_TOKEN.*read_repository/);
  });
});
