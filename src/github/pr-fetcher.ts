import { config } from "../config.js";
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

// `baseRefOid` is deliberately absent: older `gh` versions don't expose it as a `pr view` field
// (they fail the whole call with "Unknown JSON field"), while `headRefOid` is available. The base
// SHA is fetched separately via `gh api` — see `fetchBaseSha`.
const GH_VIEW_FIELDS = "title,body,files,baseRefName,headRefName,headRefOid";

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
  // `gh` accepts the `HOST/OWNER/REPO` form, routing to the credentials for that host — so a
  // self-hosted GitHub Enterprise PR resolves once the user has run `gh auth login --hostname
  // <host>`. Redundant but valid for github.com.
  const repo = `${pr.host}/${pr.owner}/${pr.repo}`;
  const [viewJson, diff, baseSha] = await Promise.all([
    runGh(["pr", "view", String(pr.number), "--repo", repo, "--json", GH_VIEW_FIELDS]),
    runGh(["pr", "diff", String(pr.number), "--repo", repo]),
    fetchBaseSha(pr, runGh),
  ]);

  const parsed = JSON.parse(viewJson) as {
    title: string;
    body: string;
    files: { path: string }[];
    baseRefName: string;
    headRefName: string;
    headRefOid: string;
  };

  return {
    title: parsed.title,
    body: parsed.body,
    files: parsed.files.map((file) => file.path),
    diff,
    base: { ref: parsed.baseRefName, sha: baseSha },
    head: { ref: parsed.headRefName, sha: parsed.headRefOid },
  };
}

/** The PR base's commit SHA, via the REST endpoint's `.base.sha` — the base branch tip, the same
 * value the (version-gated) `baseRefOid` field would give. `gh api` reuses gh's auth and, with
 * `--hostname`, targets the PR's host, so this stays correct for GitHub Enterprise. */
async function fetchBaseSha(pr: PrRef, runGh: CommandRunner): Promise<string> {
  const out = await runGh([
    "api",
    "--hostname",
    pr.host,
    `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`,
    "--jq",
    ".base.sha",
  ]);
  return out.trim();
}

/** REST API base for a host: github.com's dedicated `api.github.com`, or GitHub Enterprise
 * Server's `https://<host>/api/v3`. */
function apiBaseUrl(host: string): string {
  return host === "github.com" ? "https://api.github.com" : `https://${host}/api/v3`;
}

const FILES_PER_PAGE = 100;

async function fetchViaHttp(
  pr: PrRef,
  fetchUrl: typeof fetch,
  token: string | undefined,
): Promise<PrMetadata> {
  const prApiUrl = `${apiBaseUrl(pr.host)}/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`;
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
  for (let page = 1; ; page++) {
    const batch = await getJson<{ filename: string }[]>(
      fetchUrl,
      `${prApiUrl}/files?per_page=${FILES_PER_PAGE}&page=${page}`,
      headers,
    );
    files.push(...batch.map((file) => file.filename));
    if (batch.length < FILES_PER_PAGE) {
      break;
    }
    // GitHub's documented cap on the number of files a PR can report; this guards against a
    // pagination bug causing an unbounded loop, not an expected limit.
    if (files.length > config.limits.maxPrFilesSafetyNet) {
      throw new Error(
        `PR file list exceeded ${config.limits.maxPrFilesSafetyNet} files while paginating ${prApiUrl}/files — aborting instead of truncating silently.`,
      );
    }
  }
  return files;
}

async function getText(
  fetchUrl: typeof fetch,
  url: string,
  headers: Record<string, string>,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchUrl(url, {
      headers,
      signal: AbortSignal.timeout(config.timeouts.githubFetchMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(
        `GitHub API request timed out after ${config.timeouts.githubFetchMs}ms: ${url}`,
      );
    }
    throw error;
  }
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
