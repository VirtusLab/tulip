/** How Tulip's own `git fetch` authenticates to a GitHub host, on top of whatever the operator's
 * git config already provides: two extra credential helpers. The forge-neutral part (no terminal
 * prompt, the failure message) is src/forge/git-auth.ts. */

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

/** Where a GitHub `git fetch` can get credentials, for the auth-failure message. */
export const GITHUB_GIT_AUTH_HINT =
  "set up git credentials for that host, run `gh auth login`, or set GITHUB_TOKEN.";
