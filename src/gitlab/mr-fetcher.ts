import { config } from "../config.js";
import { bearerAuthHeaders, getJson, getText, HttpStatusError } from "../forge/http.js";
import type { PrMetadata, PrRef } from "../forge/types.js";

export interface MrFetcherDeps {
  /** Defaults to the global `fetch`. */
  fetchUrl?: typeof fetch;
  /** Defaults to `process.env.GITLAB_TOKEN`; sent as `Authorization: Bearer` when non-empty. */
  gitlabToken?: string;
}

/** The fields Tulip reads from GitLab's single-MR response. */
interface GitLabMergeRequest {
  title: string;
  description: string | null;
  /** "12", "1000+" past GitLab's cap, or null until computed; older responses may omit it. */
  changes_count?: string | null;
  source_branch: string;
  target_branch: string;
  /** Null (or partly null) until GitLab has computed the MR's diff, shortly after creation. */
  diff_refs: { base_sha: string | null; head_sha: string | null } | null;
}

/** Names the GitLab API in HTTP errors — see src/forge/http.ts. */
const API = "GitLab";

const FILES_PER_PAGE = 100;

const SCOPES = "scopes: read_api, read_repository";
const NO_TOKEN_HINT = `for a private project, set GITLAB_TOKEN (${SCOPES})`;
const WITH_TOKEN_HINT = `check that GITLAB_TOKEN can read this project (${SCOPES})`;

/**
 * Fetches a GitLab merge request's title, description, changed files and unified diff over the
 * REST API (v4) — no `glab` CLI. Authenticates with GITLAB_TOKEN when it is set, anonymously
 * otherwise (public projects only). `base` is the merge base (`diff_refs.base_sha`): the exact
 * pre-image of the MR diff, so the checkout's base files match the diff.
 */
export async function fetchMrMetadata(pr: PrRef, deps: MrFetcherDeps = {}): Promise<PrMetadata> {
  const fetchUrl = deps.fetchUrl ?? fetch;
  const token = deps.gitlabToken ?? process.env.GITLAB_TOKEN;
  // Bearer, not GitLab's PRIVATE-TOKEN header: fetch strips Authorization on a cross-origin redirect
  // but forwards custom headers, so only this keeps the token on the MR's host.
  const headers = bearerAuthHeaders(token, "GITLAB_TOKEN");
  const mrApiUrl = `https://${pr.host}/api/v4/projects/${encodeURIComponent(pr.repoPath)}/merge_requests/${pr.number}`;

  const mr = await getJson<GitLabMergeRequest>(fetchUrl, mrApiUrl, headers, API).catch(
    (error: unknown) => {
      throw withTokenHint(error, Boolean(token));
    },
  );
  const baseSha = mr.diff_refs?.base_sha;
  const headSha = mr.diff_refs?.head_sha;
  if (!baseSha || !headSha) {
    throw new Error("GitLab hasn't computed this merge request's diff yet; retry in a moment");
  }
  const [diff, files] = await Promise.all([
    getText(fetchUrl, `${mrApiUrl}/raw_diffs`, headers, API).catch((error: unknown) => {
      if (error instanceof HttpStatusError && error.status === 404) {
        throw new Error(
          `${error.message} — this GitLab may be too old to have the merge request raw_diffs API`,
          { cause: error },
        );
      }
      throw error;
    }),
    fetchAllFiles(fetchUrl, mrApiUrl, headers),
  ]);
  assertNotTruncated(mr.changes_count, files.length);
  return {
    title: mr.title,
    body: mr.description ?? "",
    files,
    diff,
    base: { ref: mr.target_branch, sha: baseSha },
    head: { ref: mr.source_branch, sha: headSha },
  };
}

/** Every changed file's head-side path, from the paginated `/diffs` endpoint. A single oversized
 * file can still appear here without content, which the pipeline's file-list mismatch warning
 * reports; whole-MR truncation is caught by `assertNotTruncated` via `changes_count`. */
async function fetchAllFiles(
  fetchUrl: typeof fetch,
  mrApiUrl: string,
  headers: Record<string, string>,
): Promise<string[]> {
  const files: string[] = [];
  for (let page = 1; ; page++) {
    const batch = await getJson<{ new_path: string }[]>(
      fetchUrl,
      `${mrApiUrl}/diffs?per_page=${FILES_PER_PAGE}&page=${page}`,
      headers,
      API,
    );
    files.push(...batch.map((file) => file.new_path));
    if (batch.length < FILES_PER_PAGE) {
      break;
    }
    // Guards against a pagination bug causing an unbounded loop, not an expected limit.
    if (files.length > config.limits.maxPrFilesSafetyNet) {
      throw new Error(
        `MR file list exceeded ${config.limits.maxPrFilesSafetyNet} files while paginating ${mrApiUrl}/diffs — aborting instead of truncating silently.`,
      );
    }
  }
  return files;
}

/** GitLab cuts both `/diffs` and `raw_diffs` when an MR exceeds the instance's diff limits, so the
 * file-list mismatch warning can't notice. `changes_count` is the full count ("1000+" past the cap). */
function assertNotTruncated(changesCount: string | null | undefined, listed: number): void {
  if (changesCount === null || changesCount === undefined) {
    return;
  }
  if (changesCount.endsWith("+") || Number(changesCount) > listed) {
    throw new Error(
      `GitLab truncated this merge request's diff at the instance's diff limits (${changesCount} changed files, ${listed} returned); Tulip would explain only part of it`,
    );
  }
}

/** GitLab answers 401 for a rejected token, 403 for a token lacking scope and 404 for a private
 * project the caller can't see: say how to authenticate. The token never appears in the message
 * (it travels only in a header). */
function withTokenHint(error: unknown, tokenSet: boolean): unknown {
  if (
    error instanceof HttpStatusError &&
    (error.status === 401 || error.status === 403 || error.status === 404)
  ) {
    const hint = tokenSet ? WITH_TOKEN_HINT : NO_TOKEN_HINT;
    return new Error(`${error.message} — ${hint}`, { cause: error });
  }
  return error;
}
