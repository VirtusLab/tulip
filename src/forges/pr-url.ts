import type { PrRef } from "../forge/types.js";
import { parseGitHubPrUrl } from "../github/pr-url.js";
import { parseGitLabMrUrl } from "../gitlab/mr-url.js";

/** Parses a GitHub PR or GitLab MR URL. The two URL shapes are disjoint (`/<owner>/<repo>/pull/<n>`
 * vs `/<path>/-/merge_requests/<n>`), so at most one parser matches. */
export function parsePrUrl(url: string): PrRef | undefined {
  return parseGitHubPrUrl(url) ?? parseGitLabMrUrl(url);
}
