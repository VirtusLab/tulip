import { runCommand } from "./exec.js";
import type { PrRef } from "./pr-url.js";

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

/** Runs a `gh` subcommand (e.g. `["pr", "view", ...]`) and returns its stdout. Mockable in tests. */
export type CommandRunner = (args: string[]) => Promise<string>;

export interface PrFetcherDeps {
  /** Defaults to invoking the `gh` binary on PATH. */
  runGh?: CommandRunner;
  /** Defaults to the global `fetch`. */
  fetchUrl?: typeof fetch;
  /** Defaults to `process.env.GITHUB_TOKEN`; used to authenticate the HTTP fallback. */
  githubToken?: string;
}

const GH_VIEW_FIELDS = "title,body,files,baseRefName,baseRefOid,headRefName,headRefOid";

/**
 * Fetches a PR's title, description, changed files and unified diff.
 *
 * Tries the `gh` CLI first (if it's on PATH and authenticated); falls back to the
 * unauthenticated (or GITHUB_TOKEN-authenticated) GitHub REST API if `gh` is unavailable
 * or fails. Throws if both routes fail.
 */
export async function fetchPrMetadata(pr: PrRef, deps: PrFetcherDeps = {}): Promise<PrMetadata> {
  const runGh = deps.runGh ?? defaultRunGh;
  try {
    return await fetchViaGh(pr, runGh);
  } catch (ghError) {
    try {
      const fetchUrl = deps.fetchUrl ?? fetch;
      const token = deps.githubToken ?? process.env.GITHUB_TOKEN;
      return await fetchViaHttp(pr, fetchUrl, token);
    } catch (httpError) {
      throw new Error(
        `Failed to fetch PR ${pr.owner}/${pr.repo}#${pr.number}: ` +
          `gh CLI failed (${errorMessage(ghError)}); HTTP fallback failed (${errorMessage(httpError)})`,
      );
    }
  }
}

async function defaultRunGh(args: string[]): Promise<string> {
  return runCommand("gh", args);
}

async function fetchViaGh(pr: PrRef, runGh: CommandRunner): Promise<PrMetadata> {
  const repo = `${pr.owner}/${pr.repo}`;
  const [viewJson, diff] = await Promise.all([
    runGh(["pr", "view", String(pr.number), "--repo", repo, "--json", GH_VIEW_FIELDS]),
    runGh(["pr", "diff", String(pr.number), "--repo", repo]),
  ]);

  const parsed = JSON.parse(viewJson) as {
    title: string;
    body: string;
    files: { path: string }[];
    baseRefName: string;
    baseRefOid: string;
    headRefName: string;
    headRefOid: string;
  };

  return {
    title: parsed.title,
    body: parsed.body,
    files: parsed.files.map((file) => file.path),
    diff,
    base: { ref: parsed.baseRefName, sha: parsed.baseRefOid },
    head: { ref: parsed.headRefName, sha: parsed.headRefOid },
  };
}

const MAX_FILE_PAGES = 10;
const FILES_PER_PAGE = 100;

async function fetchViaHttp(
  pr: PrRef,
  fetchUrl: typeof fetch,
  token: string | undefined,
): Promise<PrMetadata> {
  const prApiUrl = `https://api.github.com/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`;
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  const [prJson, diff, files] = await Promise.all([
    getJson<{
      title: string;
      body: string | null;
      base: { ref: string; sha: string };
      head: { ref: string; sha: string };
    }>(fetchUrl, prApiUrl, { Accept: "application/vnd.github+json", ...authHeaders }),
    getText(fetchUrl, prApiUrl, { Accept: "application/vnd.github.v3.diff", ...authHeaders }),
    fetchAllFiles(fetchUrl, prApiUrl, authHeaders),
  ]);

  return {
    title: prJson.title,
    body: prJson.body ?? "",
    files,
    diff,
    base: prJson.base,
    head: prJson.head,
  };
}

async function fetchAllFiles(
  fetchUrl: typeof fetch,
  prApiUrl: string,
  authHeaders: Record<string, string>,
): Promise<string[]> {
  const headers = { Accept: "application/vnd.github+json", ...authHeaders };
  const files: string[] = [];
  for (let page = 1; page <= MAX_FILE_PAGES; page++) {
    const batch = await getJson<{ filename: string }[]>(
      fetchUrl,
      `${prApiUrl}/files?per_page=${FILES_PER_PAGE}&page=${page}`,
      headers,
    );
    files.push(...batch.map((file) => file.filename));
    if (batch.length < FILES_PER_PAGE) {
      break;
    }
  }
  return files;
}

async function getText(
  fetchUrl: typeof fetch,
  url: string,
  headers: Record<string, string>,
): Promise<string> {
  const response = await fetchUrl(url, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status} for ${url}`);
  }
  return response.text();
}

async function getJson<T>(
  fetchUrl: typeof fetch,
  url: string,
  headers: Record<string, string>,
): Promise<T> {
  return JSON.parse(await getText(fetchUrl, url, headers)) as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
