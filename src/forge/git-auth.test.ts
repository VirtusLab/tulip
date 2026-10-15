import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { credentialHelperArgs, tokenCredentialHelper, wrapAuthFailure } from "./git-auth.js";

const execFileAsync = promisify(execFile);

/** Asks real git for credentials for `host`, with `args` as the only helper config in scope: the
 * operator's config is switched off and cwd holds no repo. `env` is merged over the process env.
 * Resolves with git's answer, rejects when no helper answered. No network. */
async function credentialFill(
  args: string[],
  host: string,
  env: Record<string, string | undefined>,
): Promise<string> {
  const child = execFileAsync("git", [...args, "credential", "fill"], {
    cwd: tmpdir(),
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      ...env,
    },
  });
  child.child.stdin?.end(`protocol=https\nhost=${host}\n\n`);
  return (await child).stdout;
}

describe("tokenCredentialHelper with credentialHelperArgs (real git, no network)", () => {
  const HOST = "git.example.test";
  const args = credentialHelperArgs(HOST, [tokenCredentialHelper("TULIP_TEST_TOKEN", "someone")]);

  it("answers with the username and the token from the env var", async () => {
    const out = await credentialFill(args, HOST, { TULIP_TEST_TOKEN: "secret" });

    expect(out).toContain("username=someone\n");
    expect(out).toContain("password=secret\n");
  });

  it("passes a token with shell and printf metacharacters through verbatim", async () => {
    const token = "a%s b'\"$x`y\\z";

    const out = await credentialFill(args, HOST, { TULIP_TEST_TOKEN: token });

    expect(out).toContain(`password=${token}\n`);
  });

  it("does not hand the token to any other host", async () => {
    await expect(
      credentialFill(args, "other.example.test", { TULIP_TEST_TOKEN: "secret" }),
    ).rejects.toThrow(/could not read Username/);
  });

  it.each([undefined, ""])("stays silent when the env var is %j", async (token) => {
    await expect(credentialFill(args, HOST, { TULIP_TEST_TOKEN: token })).rejects.toThrow(
      /could not read Username/,
    );
  });

  it("uses the first helper that answers", async () => {
    const twoHelpers = credentialHelperArgs(HOST, [
      tokenCredentialHelper("TULIP_TEST_TOKEN_1", "first"),
      tokenCredentialHelper("TULIP_TEST_TOKEN_2", "second"),
    ]);

    const out = await credentialFill(twoHelpers, HOST, {
      TULIP_TEST_TOKEN_1: "one",
      TULIP_TEST_TOKEN_2: "two",
    });

    expect(out).toContain("username=first\n");
    expect(out).toContain("password=one\n");
  });
});

const REMOTE = "https://git.example.test/group/project.git";
const HINT = "set up git credentials for that host, or set SOME_TOKEN.";

describe("wrapAuthFailure", () => {
  it("returns a non-auth failure unchanged", () => {
    const failure = new Error("fatal: unable to access: Could not resolve host");
    expect(wrapAuthFailure(failure, REMOTE, HINT)).toBe(failure);
  });

  it("returns a non-Error unchanged", () => {
    expect(wrapAuthFailure("boom", REMOTE, HINT)).toBe("boom");
  });

  it.each([
    "fatal: could not read Username for 'https://git.example.test': terminal prompts disabled",
    "remote: HTTP Basic: Access denied. If a password was provided for Git authentication, it was incorrect.",
    "fatal: Authentication failed for 'https://git.example.test/group/project.git/'",
    "remote: Repository not found.",
    "git@git.example.test: Permission denied (publickey).",
    "fatal: unable to access 'https://git.example.test/group/project.git/': The requested URL returned error: 403",
  ])("wraps an auth failure with the remote, the hint and git's own output: %s", (gitLine) => {
    const failure = new Error(`Command failed: git -c credential.helper=x fetch\n${gitLine}`);

    const wrapped = wrapAuthFailure(failure, REMOTE, HINT) as Error;

    expect(wrapped.message).toBe(
      `git could not authenticate to ${REMOTE}: ${HINT} If git already stores a credential for ` +
        `the host, that one was rejected and needs updating.\n${gitLine}`,
    );
    expect(wrapped.cause).toBe(failure);
  });
});
