import type { CheckoutAuth } from "../checkout/checkout.js";

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

/** What each forge supplies. */
export interface ForgeAdapter {
  /** The PR's web page, e.g. `https://github.com/owner/repo/pull/7`. */
  webUrl(pr: PrRef): string;
  /** A short reference for log lines, e.g. `owner/repo#7`. */
  label(pr: PrRef): string;
  /** Fetches the PR's title, description, changed files, diff and base/head revisions; rejects
   * with a message naming the forge's API. */
  fetchPrMetadata(pr: PrRef): Promise<PrMetadata>;
  readonly checkoutAuth: CheckoutAuth;
  /** Posts PR comments for serve mode (docs/adr/0019); absent when the forge doesn't support it. */
  readonly commenter?: PrCommenter;
  /** Shares the page on the PR (docs/adr/0029); absent when the forge doesn't support it. */
  readonly previewPublisher?: PreviewPublisher;
}

/** Posts comments on a forge's PRs. */
export interface PrCommenter {
  /** Resolves when comments can be posted to `host`; otherwise rejects with a user-actionable
   * message. */
  checkAuth(host: string): Promise<void>;
  /** Posts `body` as a comment on the PR at `prUrl`; resolves with the comment's URL. */
  postComment(prUrl: string, body: string): Promise<string>;
}

export interface Preview {
  /** The single-file page. */
  page: string;
  headSha: string;
  generatedAt: Date;
}

export interface PreviewPublisher {
  /** Read-only, so it can run before any LLM work and fail fast. */
  prepare(pr: PrRef): Promise<PreparedPreview>;
}

export interface PreparedPreview {
  /** Where the preview will go, when the user wouldn't expect it. */
  notice?: string;
  /** `signal` stops it between steps, e.g. on Ctrl+C. */
  publish(preview: Preview, signal?: AbortSignal): Promise<PublishedPreview>;
}

export interface PublishedPreview {
  commentUrl: string;
  previewUrl: string;
  /** Follow-up steps that failed after the comment was posted. */
  warnings: string[];
}
