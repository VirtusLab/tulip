import { describe, expect, it, vi } from "vitest";
import { fetchPrMetadata } from "./pr-fetcher.js";
import type { PrRef } from "./pr-url.js";

const PR: PrRef = { owner: "owner", repo: "repo", number: 42 };

const GH_VIEW_JSON = JSON.stringify({
  title: "Add feature",
  body: "Does a thing",
  files: [{ path: "src/a.ts" }, { path: "src/b.ts" }],
  baseRefName: "main",
  baseRefOid: "base-sha",
  headRefName: "feature",
  headRefOid: "head-sha",
});
const GH_DIFF = "diff --git a/src/a.ts b/src/a.ts\n";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("fetchPrMetadata", () => {
  it("fetches via gh when it succeeds", async () => {
    const runGh = vi.fn(async (args: string[]) => {
      if (args[1] === "view") return GH_VIEW_JSON;
      if (args[1] === "diff") return GH_DIFF;
      throw new Error(`unexpected gh args: ${args.join(" ")}`);
    });

    const result = await fetchPrMetadata(PR, { runGh });

    expect(result).toEqual({
      title: "Add feature",
      body: "Does a thing",
      files: ["src/a.ts", "src/b.ts"],
      diff: GH_DIFF,
      base: { ref: "main", sha: "base-sha" },
      head: { ref: "feature", sha: "head-sha" },
    });
    expect(runGh).toHaveBeenCalledWith([
      "pr",
      "view",
      "42",
      "--repo",
      "owner/repo",
      "--json",
      "title,body,files,baseRefName,baseRefOid,headRefName,headRefOid",
    ]);
  });

  it("falls back to the HTTP API when gh is unavailable", async () => {
    const runGh = vi.fn(async () => {
      throw new Error("gh: command not found");
    });
    const fetchUrl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = url.toString();
      const headers = new Headers(init?.headers);
      if (
        href.endsWith("/pulls/42") &&
        headers.get("Accept") === "application/vnd.github.v3.diff"
      ) {
        return new Response(GH_DIFF, { status: 200 });
      }
      if (href.endsWith("/pulls/42")) {
        return jsonResponse({
          title: "Add feature",
          body: "Does a thing",
          base: { ref: "main", sha: "base-sha" },
          head: { ref: "feature", sha: "head-sha" },
        });
      }
      if (href.includes("/pulls/42/files")) {
        return jsonResponse([{ filename: "src/a.ts" }, { filename: "src/b.ts" }]);
      }
      throw new Error(`unexpected url: ${href}`);
    });

    const result = await fetchPrMetadata(PR, {
      runGh,
      fetchUrl: fetchUrl as unknown as typeof fetch,
    });

    expect(result).toEqual({
      title: "Add feature",
      body: "Does a thing",
      files: ["src/a.ts", "src/b.ts"],
      diff: GH_DIFF,
      base: { ref: "main", sha: "base-sha" },
      head: { ref: "feature", sha: "head-sha" },
    });
  });

  it("paginates the file list when a page is exactly full", async () => {
    const runGh = vi.fn(async () => {
      throw new Error("gh: command not found");
    });
    const page1 = Array.from({ length: 100 }, (_, i) => ({ filename: `file-${i}.ts` }));
    const page2 = [{ filename: "file-100.ts" }];
    const fetchUrl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = url.toString();
      const headers = new Headers(init?.headers);
      if (headers.get("Accept") === "application/vnd.github.v3.diff") {
        return new Response(GH_DIFF);
      }
      const page = new URL(href).searchParams.get("page");
      if (page === "1") return jsonResponse(page1);
      if (page === "2") return jsonResponse(page2);
      if (href.endsWith("/pulls/42")) {
        return jsonResponse({
          title: "t",
          body: null,
          base: { ref: "main", sha: "base-sha" },
          head: { ref: "feature", sha: "head-sha" },
        });
      }
      throw new Error(`unexpected url: ${href}`);
    });

    const result = await fetchPrMetadata(PR, {
      runGh,
      fetchUrl: fetchUrl as unknown as typeof fetch,
    });

    expect(result.files).toHaveLength(101);
    expect(result.files[0]).toBe("file-0.ts");
    expect(result.files[100]).toBe("file-100.ts");
  });

  it("sends an Authorization header when a token is provided", async () => {
    const runGh = vi.fn(async () => {
      throw new Error("gh: command not found");
    });
    const fetchUrl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer secret-token");
      const href = url.toString();
      if (headers.get("Accept") === "application/vnd.github.v3.diff") return new Response(GH_DIFF);
      if (href.includes("/files")) return jsonResponse([]);
      return jsonResponse({
        title: "t",
        body: null,
        base: { ref: "main", sha: "base-sha" },
        head: { ref: "feature", sha: "head-sha" },
      });
    });

    await fetchPrMetadata(PR, {
      runGh,
      fetchUrl: fetchUrl as unknown as typeof fetch,
      githubToken: "secret-token",
    });

    expect(fetchUrl).toHaveBeenCalled();
  });

  it("passes an abort signal to every HTTP fallback request", async () => {
    const runGh = vi.fn(async () => {
      throw new Error("gh: command not found");
    });
    const fetchUrl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      const href = url.toString();
      const headers = new Headers(init?.headers);
      if (headers.get("Accept") === "application/vnd.github.v3.diff") return new Response(GH_DIFF);
      if (href.includes("/files")) return jsonResponse([]);
      return jsonResponse({
        title: "t",
        body: null,
        base: { ref: "main", sha: "base-sha" },
        head: { ref: "feature", sha: "head-sha" },
      });
    });

    await fetchPrMetadata(PR, { runGh, fetchUrl: fetchUrl as unknown as typeof fetch });

    expect(fetchUrl).toHaveBeenCalled();
  });

  it("reports a clear timeout error when an HTTP fallback request times out", async () => {
    const runGh = vi.fn(async () => {
      throw new Error("gh: command not found");
    });
    const fetchUrl = vi.fn(async () => {
      const error = new Error("The operation was aborted due to timeout");
      error.name = "TimeoutError";
      throw error;
    });

    await expect(
      fetchPrMetadata(PR, { runGh, fetchUrl: fetchUrl as unknown as typeof fetch }),
    ).rejects.toThrow(/timed out after \d+ms/);
  });

  it("throws a combined error when both gh and HTTP fail", async () => {
    const runGh = vi.fn(async () => {
      throw new Error("gh failed");
    });
    const fetchUrl = vi.fn(async () => new Response("nope", { status: 500 }));

    await expect(
      fetchPrMetadata(PR, { runGh, fetchUrl: fetchUrl as unknown as typeof fetch }),
    ).rejects.toThrow(/gh CLI failed.*HTTP fallback failed/s);
  });
});
