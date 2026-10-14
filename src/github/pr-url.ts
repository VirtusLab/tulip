import type { PrRef } from "../forge/types.js";

// The host is a bare hostname with an optional port. Userinfo (`user@host`) is refused: it would
// let `https://github.com@evil.example.com/...` read as a github.com link while every request,
// with the operator's credentials, went to evil.example.com.
const GITHUB_PR_URL_PATTERN =
  /^https:\/\/(?<host>[A-Za-z0-9.-]+(?::\d+)?)\/(?<owner>[^/\s]+)\/(?<repo>[^/\s]+)\/pull\/(?<number>\d+)\/?$/;

/**
 * Parses a GitHub PR URL into its parts. Accepts any host with the GitHub `/pull/<n>` shape — both
 * `https://github.com/owner/repo/pull/123` and a self-hosted GitHub Enterprise URL such as
 * `https://git.xyz.com/owner/repo/pull/7`. The host isn't verified to be GitHub (nothing in the
 * URL distinguishes a self-hosted GitHub from another forge with the same path shape).
 */
export function parseGitHubPrUrl(url: string): PrRef | undefined {
  const groups = GITHUB_PR_URL_PATTERN.exec(url)?.groups;
  if (!groups) {
    return undefined;
  }
  return {
    forge: "github",
    host: groups.host ?? "",
    repoPath: `${groups.owner ?? ""}/${groups.repo ?? ""}`,
    number: Number(groups.number),
  };
}
