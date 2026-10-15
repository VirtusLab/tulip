import { tokenCredentialHelper } from "../checkout/git-auth.js";
import type { ForgeAdapter } from "../forge/types.js";
import { fetchMrMetadata } from "./mr-fetcher.js";
import { gitlabMrLabel, gitlabMrUrl } from "./mr-url.js";

/** GitLab (gitlab.com or self-hosted): REST API only, no `glab` (see mr-fetcher.ts). */
export const gitlabAdapter: ForgeAdapter = {
  webUrl: gitlabMrUrl,
  label: gitlabMrLabel,
  fetchPrMetadata: (pr) => fetchMrMetadata(pr),
  // GitLab accepts a personal access token with any non-blank username; `oauth2` is the usual one.
  gitCredentialHelpers: [tokenCredentialHelper("GITLAB_TOKEN", "oauth2")],
  gitAuthHint:
    "set up git credentials for that host, or set GITLAB_TOKEN (scope: read_repository).",
};
