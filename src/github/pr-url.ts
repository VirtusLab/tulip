/** A GitHub PR, identified by its repository and PR number. */
export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

const GITHUB_PR_URL_PATTERN =
  /^https:\/\/github\.com\/(?<owner>[^/\s]+)\/(?<repo>[^/\s]+)\/pull\/(?<number>\d+)\/?$/;

/** Parses a GitHub PR URL (e.g. `https://github.com/owner/repo/pull/123`) into its parts. */
export function parsePrUrl(url: string): PrRef | undefined {
  const groups = GITHUB_PR_URL_PATTERN.exec(url)?.groups;
  if (!groups) {
    return undefined;
  }
  return { owner: groups.owner ?? "", repo: groups.repo ?? "", number: Number(groups.number) };
}
