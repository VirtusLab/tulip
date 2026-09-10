/** A GitHub PR, identified by its host, repository and PR number. `host` is the URL's hostname
 * (`github.com`, or a self-hosted GitHub Enterprise host like `git.xyz.com`), used to fetch and
 * clone against the right server. */
export interface PrRef {
  host: string;
  owner: string;
  repo: string;
  number: number;
}

const GITHUB_PR_URL_PATTERN =
  /^https:\/\/(?<host>[^/\s]+)\/(?<owner>[^/\s]+)\/(?<repo>[^/\s]+)\/pull\/(?<number>\d+)\/?$/;

/**
 * Parses a GitHub PR URL into its parts. Accepts any host with the GitHub `/pull/<n>` shape — both
 * `https://github.com/owner/repo/pull/123` and a self-hosted GitHub Enterprise URL such as
 * `https://git.xyz.com/owner/repo/pull/7`. The host isn't verified to be GitHub (nothing in the
 * URL distinguishes a self-hosted GitHub from another forge with the same path shape).
 */
export function parsePrUrl(url: string): PrRef | undefined {
  const groups = GITHUB_PR_URL_PATTERN.exec(url)?.groups;
  if (!groups) {
    return undefined;
  }
  return {
    host: groups.host ?? "",
    owner: groups.owner ?? "",
    repo: groups.repo ?? "",
    number: Number(groups.number),
  };
}
