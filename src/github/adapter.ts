import { tokenCredentialHelper } from "../checkout/git-auth.js";
import type { ForgeAdapter } from "../forge/types.js";
import { checkGhAuth } from "./gh-auth.js";
import { postPrComment } from "./pr-comment.js";
import { fetchPrMetadata } from "./pr-fetcher.js";
import { githubPrLabel, githubPrUrl } from "./pr-url.js";

/** GitHub and GitHub Enterprise: `gh` first, then the REST API (see pr-fetcher.ts). */
export const githubAdapter: ForgeAdapter = {
  webUrl: githubPrUrl,
  label: githubPrLabel,
  fetchPrMetadata: (pr) => fetchPrMetadata(pr),
  // A logged-in `gh`, then GITHUB_TOKEN: the order fetchPrMetadata uses.
  gitCredentialHelpers: [
    "!gh auth git-credential",
    tokenCredentialHelper("GITHUB_TOKEN", "x-access-token"),
  ],
  gitAuthHint: "set up git credentials for that host, run `gh auth login`, or set GITHUB_TOKEN.",
  commenter: {
    checkAuth: (host) => checkGhAuth(host),
    postComment: (prUrl, body) => postPrComment(prUrl, body),
  },
};
