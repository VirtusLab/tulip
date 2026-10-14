import { describe, expect, it, vi } from "vitest";
import { config } from "../config.js";
import type { PrRef } from "../forge/types.js";
import { fetchMrMetadata } from "./mr-fetcher.js";

const MR: PrRef = {
  forge: "gitlab",
  host: "git.example.com",
  repoPath: "group/sub/project",
  number: 7,
};
const API_ROOT = "https://git.example.com/api/v4/projects/group%2Fsub%2Fproject/merge_requests/7";
const RAW_DIFF = "diff --git a/src/a.ts b/src/a.ts\n";
const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const MR_JSON = {
  title: "Add feature",
  changes_count: "1",
  description: "Does a thing",
  source_branch: "feature",
  target_branch: "main",
  diff_refs: { base_sha: BASE_SHA, head_sha: HEAD_SHA, start_sha: "c".repeat(40) },
};
const NO_TOKEN_HINT = "for a private project, set GITLAB_TOKEN (scopes: read_api, read_repository)";
const WITH_TOKEN_HINT = "check that GITLAB_TOKEN can read this project";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

/** Answers the three endpoints fetchMrMetadata calls. `pages` are the `/diffs` pages in order. */
function gitlabApi(
  options: {
    mr?: unknown;
    pages?: { new_path: string }[][];
    status?: number;
    /** Fails only the endpoint whose URL ends with this suffix (e.g. "/raw_diffs"). */
    failSuffix?: { suffix: string; status: number };
  } = {},
) {
  const pages = options.pages ?? [[{ new_path: "src/a.ts" }]];
  return vi.fn(async (url: string | URL, _init?: RequestInit) => {
    const href = url.toString();
    if (options.status !== undefined) {
      return new Response("{}", { status: options.status });
    }
    if (options.failSuffix && href.split("?")[0]?.endsWith(options.failSuffix.suffix)) {
      return new Response("{}", { status: options.failSuffix.status });
    }
    if (href === API_ROOT) {
      return jsonResponse(options.mr ?? MR_JSON);
    }
    if (href === `${API_ROOT}/raw_diffs`) {
      return new Response(RAW_DIFF);
    }
    if (href.startsWith(`${API_ROOT}/diffs?`)) {
      const page = Number(new URL(href).searchParams.get("page"));
      return jsonResponse(pages[page - 1] ?? []);
    }
    throw new Error(`unexpected url: ${href}`);
  });
}

function asFetch(fn: ReturnType<typeof gitlabApi>): typeof fetch {
  return fn as unknown as typeof fetch;
}

describe("fetchMrMetadata", () => {
  it("maps the MR, its raw diff and its file list to PrMetadata", async () => {
    const fetchUrl = gitlabApi();

    const result = await fetchMrMetadata(MR, { fetchUrl: asFetch(fetchUrl), gitlabToken: "" });

    expect(result).toEqual({
      title: "Add feature",
      body: "Does a thing",
      files: ["src/a.ts"],
      diff: RAW_DIFF,
      base: { ref: "main", sha: BASE_SHA },
      head: { ref: "feature", sha: HEAD_SHA },
    });
    expect(fetchUrl).toHaveBeenCalledTimes(3);
    const urls = fetchUrl.mock.calls.map(([url]) => url.toString());
    expect(urls).toContain(API_ROOT);
    expect(urls).toContain(`${API_ROOT}/raw_diffs`);
    expect(urls).toContain(`${API_ROOT}/diffs?per_page=100&page=1`);
  });

  it("turns a null description into an empty body", async () => {
    const fetchUrl = gitlabApi({ mr: { ...MR_JSON, description: null } });

    const result = await fetchMrMetadata(MR, { fetchUrl: asFetch(fetchUrl), gitlabToken: "" });

    expect(result.body).toBe("");
  });

  it("sends GITLAB_TOKEN as a Bearer token on every request when set", async () => {
    const fetchUrl = gitlabApi();

    await fetchMrMetadata(MR, { fetchUrl: asFetch(fetchUrl), gitlabToken: "glpat-secret" });

    for (const [, init] of fetchUrl.mock.calls) {
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer glpat-secret");
      // fetch forwards custom headers across a cross-origin redirect but strips Authorization.
      expect(headers.get("PRIVATE-TOKEN")).toBeNull();
    }
  });

  it("sends no token when the token is empty", async () => {
    const fetchUrl = gitlabApi();

    await fetchMrMetadata(MR, { fetchUrl: asFetch(fetchUrl), gitlabToken: "" });

    for (const [, init] of fetchUrl.mock.calls) {
      expect(new Headers(init?.headers).get("Authorization")).toBeNull();
    }
  });

  it("paginates the file list when a page is exactly full", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ new_path: `file-${i}.ts` }));
    const fetchUrl = gitlabApi({ pages: [page1, [{ new_path: "file-100.ts" }]] });

    const result = await fetchMrMetadata(MR, { fetchUrl: asFetch(fetchUrl), gitlabToken: "" });

    expect(result.files).toHaveLength(101);
    expect(result.files[100]).toBe("file-100.ts");
  });

  it("aborts instead of paginating past the safety net", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({ new_path: `file-${i}.ts` }));
    const pages = Array.from(
      { length: Math.ceil(config.limits.maxPrFilesSafetyNet / 100) + 2 },
      () => fullPage,
    );
    const fetchUrl = gitlabApi({ pages });

    await expect(
      fetchMrMetadata(MR, { fetchUrl: asFetch(fetchUrl), gitlabToken: "" }),
    ).rejects.toThrow(/exceeded \d+ files/);
  });

  it.each([null, { base_sha: null, head_sha: HEAD_SHA }, { base_sha: BASE_SHA, head_sha: null }])(
    "asks to retry when GitLab hasn't computed diff_refs yet: %j",
    async (diffRefs) => {
      const fetchUrl = gitlabApi({ mr: { ...MR_JSON, diff_refs: diffRefs } });

      await expect(
        fetchMrMetadata(MR, { fetchUrl: asFetch(fetchUrl), gitlabToken: "" }),
      ).rejects.toThrow("GitLab hasn't computed this merge request's diff yet; retry in a moment");
      expect(fetchUrl).toHaveBeenCalledTimes(1);
    },
  );

  it.each([401, 403, 404])(
    "tells a token holder to check GITLAB_TOKEN on a %i, never echoing the token",
    async (status) => {
      const fetchUrl = gitlabApi({ status });

      const error: Error = await fetchMrMetadata(MR, {
        fetchUrl: asFetch(fetchUrl),
        gitlabToken: "glpat-secret",
      }).catch((e) => e);

      expect(error.message).toMatch(new RegExp(`GitLab API returned ${status} for https://`));
      expect(error.message).toContain(WITH_TOKEN_HINT);
      expect(error.message).not.toContain("glpat-secret");
    },
  );

  it("tells an anonymous caller to set GITLAB_TOKEN on a 404", async () => {
    const fetchUrl = gitlabApi({ status: 404 });

    const error: Error = await fetchMrMetadata(MR, {
      fetchUrl: asFetch(fetchUrl),
      gitlabToken: "",
    }).catch((e) => e);

    expect(error.message).toContain(NO_TOKEN_HINT);
  });

  it("adds no token hint when only raw_diffs fails", async () => {
    const fetchUrl = gitlabApi({ failSuffix: { suffix: "/raw_diffs", status: 404 } });

    const error: Error = await fetchMrMetadata(MR, {
      fetchUrl: asFetch(fetchUrl),
      gitlabToken: "",
    }).catch((e) => e);

    expect(error.message).toMatch(/GitLab API returned 404/);
    expect(error.message).not.toContain("GITLAB_TOKEN");
  });

  it("hints at an old GitLab when raw_diffs 404s after the MR itself was fetched", async () => {
    const fetchUrl = gitlabApi({ failSuffix: { suffix: "/raw_diffs", status: 404 } });

    const error: Error = await fetchMrMetadata(MR, {
      fetchUrl: asFetch(fetchUrl),
      gitlabToken: "",
    }).catch((e) => e);

    expect(error.message).toContain("too old to have the merge request raw_diffs API");
    expect(error.message).not.toContain("GITLAB_TOKEN");
  });

  it.each([
    ["1000+", [{ new_path: "a.ts" }]],
    ["5", [{ new_path: "a.ts" }]],
  ])("rejects a truncated MR (changes_count %s)", async (changesCount, page) => {
    const fetchUrl = gitlabApi({ mr: { ...MR_JSON, changes_count: changesCount }, pages: [page] });

    await expect(
      fetchMrMetadata(MR, { fetchUrl: asFetch(fetchUrl), gitlabToken: "" }),
    ).rejects.toThrow(/truncated this merge request's diff/);
  });

  it("accepts a null changes_count", async () => {
    const fetchUrl = gitlabApi({ mr: { ...MR_JSON, changes_count: null } });

    const result = await fetchMrMetadata(MR, { fetchUrl: asFetch(fetchUrl), gitlabToken: "" });

    expect(result.files).toEqual(["src/a.ts"]);
  });

  it("rejects a malformed token without echoing it or sending a request", async () => {
    const fetchUrl = gitlabApi();

    const error: Error = await fetchMrMetadata(MR, {
      fetchUrl: asFetch(fetchUrl),
      gitlabToken: "glpat-ab\ncd",
    }).catch((e) => e);

    expect(error.message).toContain("can't be sent in an HTTP header");
    expect(error.message).not.toContain("glpat-ab");
    expect(fetchUrl).not.toHaveBeenCalled();
  });

  it("leaves other HTTP errors without the token hint", async () => {
    const fetchUrl = gitlabApi({ status: 500 });

    const error: Error = await fetchMrMetadata(MR, {
      fetchUrl: asFetch(fetchUrl),
      gitlabToken: "",
    }).catch((e) => e);

    expect(error.message).toMatch(/GitLab API returned 500/);
    expect(error.message).not.toContain("GITLAB_TOKEN");
  });
});
