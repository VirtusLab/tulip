import type { PrRef } from "../forge/types.js";

// The host is a bare hostname with an optional port, never userinfo (see src/github/pr-url.ts).
// The project path is everything before GitLab's `/-/` route separator; its segments are checked
// separately below, since it is interpolated into both the clone URL and the API URL.
const GITLAB_MR_URL_PATTERN =
  /^https:\/\/(?<host>[A-Za-z0-9.-]+(?::\d+)?)\/(?<path>[^?#\s]+?)\/-\/merge_requests\/(?<iid>[1-9]\d{0,9})\/?$/;

/** A GitLab namespace or project path segment. */
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

/** `-` is GitLab's route separator; `.` and `..` would walk out of the project in a URL. */
const FORBIDDEN_SEGMENTS = new Set(["-", ".", ".."]);

/**
 * Parses a GitLab merge request URL — `https://gitlab.com/group/project/-/merge_requests/12`, or a
 * self-hosted one with nested groups such as
 * `https://git.example.com/group/sub/project/-/merge_requests/7`. The project path needs at least
 * two segments (a namespace and a project). URLs with a tab suffix (`.../merge_requests/7/diffs`)
 * are not accepted.
 */
export function parseGitLabMrUrl(url: string): PrRef | undefined {
  const groups = GITLAB_MR_URL_PATTERN.exec(url)?.groups;
  if (!groups?.host || !groups.path || !groups.iid) {
    return undefined;
  }
  const segments = groups.path.split("/");
  if (segments.length < 2 || !segments.every(isValidSegment)) {
    return undefined;
  }
  return { forge: "gitlab", host: groups.host, repoPath: groups.path, number: Number(groups.iid) };
}

function isValidSegment(segment: string): boolean {
  return PATH_SEGMENT_PATTERN.test(segment) && !FORBIDDEN_SEGMENTS.has(segment);
}
