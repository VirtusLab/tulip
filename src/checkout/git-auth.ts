/** How Tulip's own `git fetch` authenticates: credential helpers, no terminal prompt, and a hint
 * on failure. */

/** A git credential helper answering `get` with `username` and the token in env var `envName`, read
 * when git runs the helper, so the token is never on a command line. Silent when the variable is
 * unset or empty. `envName` and `username` must be constants (they are inlined into a shell
 * snippet); the token must not contain a newline. */
export function tokenCredentialHelper(envName: string, username: string): string {
  return `!f() { test "$1" = get && test -n "$${envName}" && printf "username=${username}\\npassword=%s\\n" "$${envName}"; }; f`;
}

/** `-c` args adding `helpers`, in order, for `https://<host>` and no other URL. Git consults helpers
 * in config order and stops at the first that answers, so the operator's own helpers come first
 * and these only fill in when none of them has a credential for the host. */
export function credentialHelperArgs(host: string, helpers: string[]): string[] {
  return helpers.flatMap((helper) => ["-c", `credential.https://${host}.helper=${helper}`]);
}

/** Makes an https fetch with no usable credentials fail at once instead of asking for a username
 * and password on the terminal — a prompt the forges reject anyway, and one that stalls a
 * non-interactive run. Only git's own prompts are affected: a configured askpass program may be
 * what supplies the credentials, and ssh (after an `insteadOf` rewrite) prompts as it always does. */
export const GIT_NO_PROMPT_ENV = { GIT_TERMINAL_PROMPT: "0" };

/** git's messages for missing or rejected https credentials (GitLab answers a rejected one with
 * `HTTP Basic: Access denied`), a rejected SSH key, and "not found". The last counts because the
 * PR's metadata was fetched already, so the repo exists: the forges answer 404 for a private repo
 * the presented credentials can't see. */
const AUTH_FAILURE_PATTERN =
  /could not read (Username|Password)|Authentication failed|HTTP Basic: Access denied|returned error: 40[13]|repository[^\n]*not found|Permission denied \(publickey\)/i;

/** Returns `error` unchanged unless it is a git failure caused by authentication; then an Error
 * whose message names where credentials can come from (`hint`), followed by git's own output. */
export function wrapAuthFailure(error: unknown, remoteUrl: string, hint: string): unknown {
  if (!(error instanceof Error) || !AUTH_FAILURE_PATTERN.test(error.message)) {
    return error;
  }
  return new Error(
    `git could not authenticate to ${remoteUrl}: ${hint} If git already stores a credential for ` +
      `the host, that one was rejected and needs updating.\n${gitOutput(error)}`,
    { cause: error },
  );
}

/** execFile's message opens with `Command failed: <argv>`; with the helper snippets in argv that
 * line buries the useful part, so only git's own output is kept. */
function gitOutput(error: Error): string {
  const lines = error.message.split("\n");
  return (lines[0]?.startsWith("Command failed:") ? lines.slice(1) : lines).join("\n").trim();
}
