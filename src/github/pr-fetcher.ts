import { bearerAuthHeaders, getAllPages, getJson, getText } from "../forge/http.js";
import { fetchConsistentMetadata, type PrRevisions, type PrSource } from "../forge/pr-source.js";
import type { PrMetadata, PrRef } from "../forge/types.js";
import { type CommandRunner, defaultRunGh } from "./gh.js";
import { githubPrLabel } from "./pr-url.js";

export interface PrFetcherDeps {
  /** Defaults to invoking the `gh` binary on PATH. */
  runGh?: CommandRunner;
  /** Defaults to the global `fetch`. */
  fetchUrl?: typeof fetch;
  /** Defaults to `process.env.GITHUB_TOKEN`; used to authenticate the HTTP fallback. */
  githubToken?: string;
}

/**
 * Fetches a PR's title, description, changed files and unified diff.
 *
 * Tries the `gh` CLI first (if it's on PATH and authenticated); falls back to the
 * unauthenticated (or GITHUB_TOKEN-authenticated) GitHub REST API if `gh` is unavailable
 * or fails. Throws if both routes fail.
 */
export async function fetchPrMetadata(pr: PrRef, deps: PrFetcherDeps = {}): Promise<PrMetadata> {
  try {
    return await fetchConsistentMetadata(ghSource(deps.runGh ?? defaultRunGh), pr);
  } catch (ghError) {
    try {
      const token = deps.githubToken ?? process.env.GITHUB_TOKEN;
      return await fetchConsistentMetadata(restSource(deps.fetchUrl ?? fetch, token), pr);
    } catch (httpError) {
      throw new Error(
        `Failed to fetch PR ${githubPrLabel(pr)}: ` +
          `gh CLI failed (${errorMessage(ghError)}); HTTP fallback failed (${errorMessage(httpError)})`,
      );
    }
  }
}

/** Picks the REST response's base/head `{ ref, sha }` pairs. */
const REVISIONS_JQ =
  "{base: {ref: .base.ref, sha: .base.sha}, head: {ref: .head.ref, sha: .head.sha}}";

function ghSource(runGh: CommandRunner): PrSource {
  return {
    // Via `gh api`, not `pr view`: older `gh` versions lack the `baseRefOid` view field (they fail
    // the whole call with "Unknown JSON field"). `gh api` reuses gh's auth and, with `--hostname`,
    // targets the PR's host, so this stays correct for GitHub Enterprise.
    fetchRevisions: async (pr) => {
      const revisionsJson = await runGh([
        "api",
        "--hostname",
        pr.host,
        `repos/${pr.repoPath}/pulls/${pr.number}`,
        "--jq",
        REVISIONS_JQ,
      ]);
      return JSON.parse(revisionsJson) as PrRevisions;
    },
    fetchContent: async (pr) => {
      // `gh` accepts the `HOST/OWNER/REPO` form, routing to the credentials for that host — so a
      // self-hosted GitHub Enterprise PR resolves once the user has run `gh auth login --hostname
      // <host>`. Redundant but valid for github.com.
      const repo = `${pr.host}/${pr.repoPath}`;
      const [viewJson, diff] = await Promise.all([
        runGh(["pr", "view", String(pr.number), "--repo", repo, "--json", "title,body,files"]),
        runGh(["pr", "diff", String(pr.number), "--repo", repo]),
      ]);
      const view = JSON.parse(viewJson) as {
        title: string;
        body: string;
        files: { path: string }[];
      };
      return {
        title: view.title,
        body: view.body,
        files: view.files.map((file) => file.path),
        diff,
      };
    },
  };
}

/** REST API base for a host: github.com's dedicated `api.github.com`, or GitHub Enterprise
 * Server's `https://<host>/api/v3`. */
function apiBaseUrl(host: string): string {
  return host === "github.com" ? "https://api.github.com" : `https://${host}/api/v3`;
}

const API_NAME = "GitHub";

/** The fields Tulip reads from GitHub's single-PR response. */
interface GitHubPull {
  title: string;
  body: string | null;
  base: { ref: string; sha: string };
  head: { ref: string; sha: string };
}

function restSource(fetchUrl: typeof fetch, token: string | undefined): PrSource {
  const authHeaders = bearerAuthHeaders(token, "GITHUB_TOKEN");
  const jsonHeaders = { Accept: "application/vnd.github+json", ...authHeaders };
  const diffHeaders = { Accept: "application/vnd.github.v3.diff", ...authHeaders };
  const pullUrl = (pr: PrRef) => `${apiBaseUrl(pr.host)}/repos/${pr.repoPath}/pulls/${pr.number}`;
  return {
    fetchRevisions: async (pr) => {
      const pull = await getJson<GitHubPull>(fetchUrl, pullUrl(pr), jsonHeaders, API_NAME);
      return { base: pull.base, head: pull.head };
    },
    fetchContent: async (pr) => {
      const url = pullUrl(pr);
      const [pull, diff, files] = await Promise.all([
        getJson<GitHubPull>(fetchUrl, url, jsonHeaders, API_NAME),
        getText(fetchUrl, url, diffHeaders, API_NAME),
        getAllPages<{ filename: string }>(fetchUrl, `${url}/files`, jsonHeaders, API_NAME),
      ]);
      return {
        title: pull.title,
        body: pull.body ?? "",
        files: files.map((file) => file.filename),
        diff,
      };
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
