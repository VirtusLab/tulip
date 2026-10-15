import type { PrRef } from "../forge/types.js";
import { HOST_PATTERN, isValidRepoPath, NUMBER_PATTERN } from "../forge/url-parts.js";

// The project path is everything before GitLab's `/-/` route separator.
const GITLAB_MR_URL_PATTERN = new RegExp(
  `^https://(?<host>${HOST_PATTERN})/(?<repoPath>[^?#\\s]+?)/-/merge_requests/(?<number>${NUMBER_PATTERN})/?$`,
);

/**
 * Parses a GitLab merge request URL — `https://gitlab.com/group/project/-/merge_requests/12`, or a
 * self-hosted one with nested groups such as
 * `https://git.example.com/group/sub/project/-/merge_requests/7`. The project path needs at least
 * two segments (a namespace and a project). URLs with a tab suffix (`.../merge_requests/7/diffs`)
 * are not accepted.
 */
export function parseGitLabMrUrl(url: string): PrRef | undefined {
  const groups = GITLAB_MR_URL_PATTERN.exec(url)?.groups;
  if (!groups?.host || !groups.repoPath?.includes("/") || !isValidRepoPath(groups.repoPath)) {
    return undefined;
  }
  return {
    forge: "gitlab",
    host: groups.host,
    repoPath: groups.repoPath,
    number: Number(groups.number),
  };
}

/** The MR's web page, e.g. `https://gitlab.com/group/project/-/merge_requests/7`. */
export function gitlabMrUrl(pr: PrRef): string {
  return `https://${pr.host}/${pr.repoPath}/-/merge_requests/${pr.number}`;
}

/** A short reference to the MR, e.g. `group/project!7`. */
export function gitlabMrLabel(pr: PrRef): string {
  return `${pr.repoPath}!${pr.number}`;
}
