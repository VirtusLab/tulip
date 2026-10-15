import type { PrRef } from "../forge/types.js";
import { HOST_PATTERN, isValidRepoPath, NUMBER_PATTERN } from "../forge/url-parts.js";

const GITHUB_PR_URL_PATTERN = new RegExp(
  `^https://(?<host>${HOST_PATTERN})/(?<repoPath>[^/]+/[^/]+)/pull/(?<number>${NUMBER_PATTERN})/?$`,
);

/**
 * Parses a GitHub PR URL into its parts. Accepts any host with the GitHub `/pull/<n>` shape — both
 * `https://github.com/owner/repo/pull/123` and a self-hosted GitHub Enterprise URL such as
 * `https://git.xyz.com/owner/repo/pull/7`. The host isn't verified to be GitHub (nothing in the
 * URL distinguishes a self-hosted GitHub from another forge with the same path shape).
 */
export function parseGitHubPrUrl(url: string): PrRef | undefined {
  const groups = GITHUB_PR_URL_PATTERN.exec(url)?.groups;
  if (!groups?.host || !groups.repoPath || !isValidRepoPath(groups.repoPath)) {
    return undefined;
  }
  return {
    forge: "github",
    host: groups.host,
    repoPath: groups.repoPath,
    number: Number(groups.number),
  };
}

/** The PR's web page, e.g. `https://github.com/owner/repo/pull/7`. */
export function githubPrUrl(pr: PrRef): string {
  return `https://${pr.host}/${pr.repoPath}/pull/${pr.number}`;
}

/** A short reference to the PR, e.g. `owner/repo#7`. */
export function githubPrLabel(pr: PrRef): string {
  return `${pr.repoPath}#${pr.number}`;
}
