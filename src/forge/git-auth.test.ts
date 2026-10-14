import { describe, expect, it } from "vitest";
import { wrapAuthFailure } from "./git-auth.js";

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
