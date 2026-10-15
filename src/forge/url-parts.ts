/** Validation shared by the forges' PR URL parsers. */

/** Regex source matching a bare hostname with an optional port. Userinfo (`user@host`) is refused:
 * it would let `https://github.com@evil.example.com/...` read as a github.com link while every
 * request, with the operator's credentials, went to evil.example.com. */
export const HOST_PATTERN = "[A-Za-z0-9.-]+(?::\\d+)?";

const SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

/** `-` is GitLab's route separator; `.` and `..` would walk out of the repo in a URL. */
const FORBIDDEN_SEGMENTS = new Set(["-", ".", ".."]);

/** Whether `repoPath` (`/`-separated, e.g. `owner/repo` or `group/sub/project`) is safe to put
 * into clone and API URLs as is: every segment is non-empty, made of letters, digits, `.`, `_` and
 * `-` only, and none is `-`, `.` or `..`. */
export function isValidRepoPath(repoPath: string): boolean {
  return repoPath
    .split("/")
    .every((segment) => SEGMENT_PATTERN.test(segment) && !FORBIDDEN_SEGMENTS.has(segment));
}
