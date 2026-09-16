/** How Tulip's own `git fetch` authenticates to a PR's host, on top of whatever the operator's git
 * config already provides: two extra credential helpers, no terminal prompt, and a hint on failure. */

/** Makes an https fetch with no usable credentials fail at once instead of asking for a username
 * and password on the terminal — a prompt GitHub rejects anyway, and one that stalls a
 * non-interactive run. Only git's own prompts are affected: a configured askpass program may be
 * what supplies the credentials, and ssh (after an `insteadOf` rewrite) prompts as it always does. */
export const GIT_NO_PROMPT_ENV = { GIT_TERMINAL_PROMPT: "0" };

const GH_CREDENTIAL_HELPER = "!gh auth git-credential";

/** Answers git's `get` with `GITHUB_TOKEN`, read from the environment when git runs the helper — the
 * token itself is never on a command line. Silent when the variable is unset or empty. */
const GITHUB_TOKEN_CREDENTIAL_HELPER =
  '!f() { test "$1" = get && test -n "$GITHUB_TOKEN" && printf "username=x-access-token\\npassword=%s\\n" "$GITHUB_TOKEN"; }; f';

/** `-c` args adding two credential helpers for `https://<host>` and no other URL: a logged-in
 * `gh`, then `GITHUB_TOKEN` — the order `fetchPrMetadata` uses. Git consults helpers in config
 * order and stops at the first that answers, so the operator's own helpers come first and these
 * only fill in when none of them has a credential for the host. */
export function gitCredentialArgs(host: string): string[] {
  const key = `credential.https://${host}.helper`;
  return ["-c", `${key}=${GH_CREDENTIAL_HELPER}`, "-c", `${key}=${GITHUB_TOKEN_CREDENTIAL_HELPER}`];
}

/** git's messages for missing or rejected https credentials, a rejected SSH key, and "not found".
 * The last counts because the PR's metadata was fetched already, so the repo exists: GitHub answers
 * 404 for a private repo the presented credentials can't see. */
const AUTH_FAILURE_PATTERN =
  /could not read (Username|Password)|Authentication failed|returned error: 40[13]|repository[^\n]*not found|Permission denied \(publickey\)/i;

/** Returns `error` unchanged unless it is a git failure caused by authentication; then an Error
 * whose message says how to make credentials available, followed by git's own output. */
export function wrapAuthFailure(error: unknown, remoteUrl: string): unknown {
  if (!(error instanceof Error) || !AUTH_FAILURE_PATTERN.test(error.message)) {
    return error;
  }
  return new Error(
    `git could not authenticate to ${remoteUrl}: set up git credentials for that host, run ` +
      "`gh auth login`, or set GITHUB_TOKEN. If git already stores a credential for the host, " +
      `that one was rejected and needs updating.\n${gitOutput(error)}`,
    { cause: error },
  );
}

/** execFile's message opens with `Command failed: <argv>`; with the helper snippets in argv that
 * line buries the useful part, so only git's own output is kept. */
function gitOutput(error: Error): string {
  const lines = error.message.split("\n");
  return (lines[0]?.startsWith("Command failed:") ? lines.slice(1) : lines).join("\n").trim();
}
