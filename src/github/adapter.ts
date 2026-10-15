import type { ForgeAdapter } from "../forge/types.js";
import { checkGhAuth } from "./gh-auth.js";
import { GITHUB_GIT_AUTH_HINT, gitCredentialArgs } from "./git-auth.js";
import { postPrComment } from "./pr-comment.js";
import { fetchPrMetadata } from "./pr-fetcher.js";

/** GitHub and GitHub Enterprise: `gh` first, then the REST API (see pr-fetcher.ts). */
export const githubForge: ForgeAdapter = {
  webUrl: (pr) => `https://${pr.host}/${pr.repoPath}/pull/${pr.number}`,
  label: (pr) => `${pr.repoPath}#${pr.number}`,
  fetchPrMetadata: (pr) => fetchPrMetadata(pr),
  gitCredentialArgs,
  gitAuthHint: GITHUB_GIT_AUTH_HINT,
  commenter: {
    checkAuth: (host) => checkGhAuth(host),
    postComment: (prUrl, body) => postPrComment(prUrl, body),
  },
};
