/** How Tulip's own `git fetch` authenticates to a GitLab host, on top of whatever the operator's
 * git config already provides: one extra credential helper. The forge-neutral part (no terminal
 * prompt, the failure message) is src/forge/git-auth.ts. */

/** Answers git's `get` with `GITLAB_TOKEN`, read from the environment when git runs the helper — the
 * token itself is never on a command line. Silent when the variable is unset or empty. GitLab
 * accepts a personal access token with any non-blank username; `oauth2` is the usual one. A newline
 * inside the token would add lines to git's credential protocol; that can't happen in practice
 * because the REST fetch (`bearerAuthHeaders` in src/forge/http.ts) rejects anything outside
 * visible ASCII, and it runs before the checkout. */
const GITLAB_TOKEN_CREDENTIAL_HELPER =
  '!f() { test "$1" = get && test -n "$GITLAB_TOKEN" && printf "username=oauth2\\npassword=%s\\n" "$GITLAB_TOKEN"; }; f';

/** `-c` args adding the GITLAB_TOKEN helper for `https://<host>` and no other URL. Git consults
 * helpers in config order and stops at the first that answers, so the operator's own helpers come
 * first and this one only fills in when none of them has a credential for the host. */
export function gitCredentialArgs(host: string): string[] {
  return ["-c", `credential.https://${host}.helper=${GITLAB_TOKEN_CREDENTIAL_HELPER}`];
}

/** Where a GitLab `git fetch` can get credentials, for the auth-failure message. */
export const GITLAB_GIT_AUTH_HINT =
  "set up git credentials for that host, or set GITLAB_TOKEN (scope: read_repository).";
