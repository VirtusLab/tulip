import type { PrRef } from "../forge/types.js";
import { HOST_PATTERN, isValidRepoPath } from "../forge/url-parts.js";

// The project path is everything before GitLab's `/-/` route separator.
const GITLAB_MR_URL_PATTERN = new RegExp(
  `^https://(?<host>${HOST_PATTERN})/(?<path>[^?#\\s]+?)/-/merge_requests/(?<iid>[1-9]\\d{0,9})/?$`,
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
  if (
    !groups?.host ||
    !groups.path?.includes("/") ||
    !isValidRepoPath(groups.path) ||
    !groups.iid
  ) {
    return undefined;
  }
  return { forge: "gitlab", host: groups.host, repoPath: groups.path, number: Number(groups.iid) };
}
