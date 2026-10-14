import type { ForgeAdapter } from "../forge/types.js";
import { GITLAB_GIT_AUTH_HINT, gitCredentialArgs } from "./git-auth.js";
import { fetchMrMetadata } from "./mr-fetcher.js";

/** GitLab (gitlab.com or self-hosted): REST API only, no `glab` (see mr-fetcher.ts). */
export const gitlabForge: ForgeAdapter = {
  webUrl: (pr) => `https://${pr.host}/${pr.repoPath}/-/merge_requests/${pr.number}`,
  label: (pr) => `${pr.repoPath}!${pr.number}`,
  fetchPrMetadata: (pr) => fetchMrMetadata(pr),
  gitCredentialArgs,
  gitAuthHint: GITLAB_GIT_AUTH_HINT,
};
