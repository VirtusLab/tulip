/** Which code host serves a pull/merge request. */
export type Forge = "github" | "gitlab";

/**
 * A GitHub pull request or GitLab merge request, identified by its forge, host, repository path
 * and number. `host` is the URL's hostname with an optional port (`github.com`, `gitlab.com`, or a
 * self-hosted host), used to fetch and clone against the right server.
 */
export interface PrRef {
  forge: Forge;
  host: string;
  /** `owner/repo` on GitHub; `group/subgroup/project` on GitLab. The clone URL is
   * `https://<host>/<repoPath>.git` on both. */
  repoPath: string;
  /** The PR number on GitHub; the MR iid on GitLab. */
  number: number;
}

/** Metadata needed to analyze a PR: what it's about, which files it touches, and its diff. */
export interface PrMetadata {
  title: string;
  body: string;
  /** Paths of all files touched by the PR (head-side path for renames). */
  files: string[];
  /** The full unified diff, as produced by `git diff` / `gh pr diff`. */
  diff: string;
  base: { ref: string; sha: string };
  head: { ref: string; sha: string };
}

/** What each forge supplies. Everything else in the pipeline is forge-neutral; `forgeFor` (see
 * src/forge/forge.ts) picks the adapter for a PR. */
export interface ForgeAdapter {
  /** The PR's web page, e.g. `https://github.com/owner/repo/pull/7`. */
  webUrl(pr: PrRef): string;
  /** A short reference for log lines, e.g. `owner/repo#7`. */
  label(pr: PrRef): string;
  /** Fetches the PR's title, description, changed files, diff and base/head revisions; rejects
   * with a message naming the forge's API. */
  fetchPrMetadata(pr: PrRef): Promise<PrMetadata>;
  /** `-c credential.https://<host>.helper=...` args added to the checkout's `git fetch`, after the
   * operator's own helpers. */
  gitCredentialArgs(host: string): string[];
  /** Where a `git fetch` that failed to authenticate can get credentials, for the error message: a
   * lowercase clause ending with a period (see `wrapAuthFailure` in src/forge/git-auth.ts). */
  readonly gitAuthHint: string;
}
