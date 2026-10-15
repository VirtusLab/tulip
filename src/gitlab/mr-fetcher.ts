import {
  bearerAuthHeaders,
  getAllPages,
  getJson,
  getText,
  HttpStatusError,
} from "../forge/http.js";
import { fetchConsistentMetadata, type PrSource } from "../forge/pr-source.js";
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
  const token = deps.gitlabToken ?? process.env.GITLAB_TOKEN;
  return fetchConsistentMetadata(restSource(deps.fetchUrl ?? fetch, token), pr);
}

function restSource(fetchUrl: typeof fetch, token: string | undefined): PrSource {
  // Bearer, not GitLab's PRIVATE-TOKEN header: fetch strips Authorization on a cross-origin redirect
  // but forwards custom headers, so only this keeps the token on the MR's host.
  const headers = bearerAuthHeaders(token, "GITLAB_TOKEN");
  const mrApiUrl = (pr: PrRef) =>
    `https://${pr.host}/api/v4/projects/${encodeURIComponent(pr.repoPath)}/merge_requests/${pr.number}`;
  const getMr = (pr: PrRef) =>
    getJson<GitLabMergeRequest>(fetchUrl, mrApiUrl(pr), headers, API).catch((error: unknown) => {
      throw withTokenHint(error, Boolean(token));
    });
  return {
    fetchRevisions: async (pr) => {
      const mr = await getMr(pr);
      const baseSha = mr.diff_refs?.base_sha;
      const headSha = mr.diff_refs?.head_sha;
      if (!baseSha || !headSha) {
        throw new Error("GitLab hasn't computed this merge request's diff yet; retry in a moment");
      }
      return {
        base: { ref: mr.target_branch, sha: baseSha },
        head: { ref: mr.source_branch, sha: headSha },
      };
    },
    fetchContent: async (pr) => {
      const url = mrApiUrl(pr);
      // The paginated `/diffs` gives every changed file's head-side path. A single oversized file
      // can still appear there without content, which the pipeline's file-list mismatch warning
      // reports; whole-MR truncation is caught by `assertNotTruncated`.
      const [mr, diff, files] = await Promise.all([
        getMr(pr),
        getText(fetchUrl, `${url}/raw_diffs`, headers, API).catch(withOldGitLabHint("raw_diffs")),
        getAllPages<{ new_path: string }>(fetchUrl, `${url}/diffs`, headers, API).catch(
          withOldGitLabHint("diffs"),
        ),
      ]);
      assertNotTruncated(mr.changes_count, files.length);
      return {
        title: mr.title,
        body: mr.description ?? "",
        files: files.map((file) => file.new_path),
        diff,
      };
    },
  };
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

/** A `.catch` handler for an MR sub-endpoint: a 404 there, once the MR itself was found, means the
 * instance predates the endpoint. */
function withOldGitLabHint(endpoint: string): (error: unknown) => never {
  return (error) => {
    if (error instanceof HttpStatusError && error.status === 404) {
      throw new Error(
        `${error.message} — this GitLab may be too old to have the merge request ${endpoint} API`,
        { cause: error },
      );
    }
    throw error;
  };
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
