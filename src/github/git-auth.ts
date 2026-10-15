/** How Tulip's own `git fetch` authenticates to a GitHub host, on top of whatever the operator's
 * git config already provides: two extra credential helpers. The forge-neutral part is
 * src/forge/git-auth.ts. */
import { credentialHelperArgs, tokenCredentialHelper } from "../forge/git-auth.js";

const GH_CREDENTIAL_HELPER = "!gh auth git-credential";

/** `-c` args adding two credential helpers for `https://<host>`: a logged-in `gh`, then
 * `GITHUB_TOKEN` — the order `fetchPrMetadata` uses. */
export function gitCredentialArgs(host: string): string[] {
  return credentialHelperArgs(host, [
    GH_CREDENTIAL_HELPER,
    tokenCredentialHelper("GITHUB_TOKEN", "x-access-token"),
  ]);
}

/** Where a GitHub `git fetch` can get credentials, for the auth-failure message. */
export const GITHUB_GIT_AUTH_HINT =
  "set up git credentials for that host, run `gh auth login`, or set GITHUB_TOKEN.";
