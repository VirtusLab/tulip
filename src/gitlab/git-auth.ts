/** How Tulip's own `git fetch` authenticates to a GitLab host, on top of whatever the operator's
 * git config already provides: one extra credential helper. The forge-neutral part is
 * src/forge/git-auth.ts. */
import { credentialHelperArgs, tokenCredentialHelper } from "../forge/git-auth.js";

/** `-c` args adding a `GITLAB_TOKEN` credential helper for `https://<host>`. GitLab accepts a
 * personal access token with any non-blank username; `oauth2` is the usual one. */
export function gitCredentialArgs(host: string): string[] {
  return credentialHelperArgs(host, [tokenCredentialHelper("GITLAB_TOKEN", "oauth2")]);
}

/** Where a GitLab `git fetch` can get credentials, for the auth-failure message. */
export const GITLAB_GIT_AUTH_HINT =
  "set up git credentials for that host, or set GITLAB_TOKEN (scope: read_repository).";
