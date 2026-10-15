import { describe, expect, it, vi } from "vitest";
import type { PrRef } from "../forge/types.js";
import { fetchPrMetadata } from "./pr-fetcher.js";

const PR: PrRef = { forge: "github", host: "github.com", repoPath: "owner/repo", number: 42 };

const GH_VIEW_JSON = JSON.stringify({
  title: "Add feature",
  body: "Does a thing",
  files: [{ path: "src/a.ts" }, { path: "src/b.ts" }],
});
const GH_REVISIONS_JSON = JSON.stringify({
  base: { ref: "main", sha: "base-sha" },
  head: { ref: "feature", sha: "head-sha" },
});
const GH_DIFF = "diff --git a/src/a.ts b/src/a.ts\n";

/** Handles the `gh` subcommands the gh route runs: `gh api` for the revisions, `pr view` and
 * `pr diff`. */
function ghRunner() {
  return vi.fn(async (args: string[]) => {
    if (args[0] === "api") return GH_REVISIONS_JSON;
    if (args[1] === "view") return GH_VIEW_JSON;
    if (args[1] === "diff") return GH_DIFF;
    throw new Error(`unexpected gh args: ${args.join(" ")}`);
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("fetchPrMetadata", () => {
  it("fetches via gh when it succeeds", async () => {
    const runGh = ghRunner();

    const result = await fetchPrMetadata(PR, { runGh });

    expect(result).toEqual({
      title: "Add feature",
      body: "Does a thing",
      files: ["src/a.ts", "src/b.ts"],
      diff: GH_DIFF,
      base: { ref: "main", sha: "base-sha" },
      head: { ref: "feature", sha: "head-sha" },
    });
    // The view never requests baseRefOid (unsupported on older gh); revisions come from `gh api`.
    expect(runGh).toHaveBeenCalledWith([
      "pr",
      "view",
      "42",
      "--repo",
      "github.com/owner/repo",
      "--json",
      "title,body,files",
    ]);
  });

  it("passes a host-qualified repo and hostname to gh for a self-hosted host", async () => {
    const runGh = ghRunner();

    await fetchPrMetadata({ ...PR, host: "git.xyz.com" }, { runGh });

    expect(runGh).toHaveBeenCalledWith(
      expect.arrayContaining(["--repo", "git.xyz.com/owner/repo"]),
    );
    expect(runGh).toHaveBeenCalledWith(
      expect.arrayContaining(["api", "--hostname", "git.xyz.com", "repos/owner/repo/pulls/42"]),
    );
  });

  it("uses the GitHub Enterprise /api/v3 base for the HTTP fallback on a self-hosted host", async () => {
    const runGh = vi.fn(async () => {
      throw new Error("gh: command not found");
    });
    const seen: string[] = [];
    const fetchUrl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = url.toString();
      seen.push(href);
      const headers = new Headers(init?.headers);
      if (headers.get("Accept") === "application/vnd.github.v3.diff") {
        return new Response(GH_DIFF, { status: 200 });
      }
      if (href.endsWith("/pulls/42")) {
        return jsonResponse({
          title: "t",
          body: null,
          base: { ref: "main", sha: "base-sha" },
          head: { ref: "feature", sha: "head-sha" },
        });
      }
      if (href.includes("/pulls/42/files")) {
        return jsonResponse([{ filename: "src/a.ts" }]);
      }
      throw new Error(`unexpected url: ${href}`);
    });

    await fetchPrMetadata(
      { ...PR, host: "git.xyz.com" },
      { runGh, fetchUrl: fetchUrl as unknown as typeof fetch },
    );

    expect(
      seen.every((href) => href.startsWith("https://git.xyz.com/api/v3/repos/owner/repo/pulls/42")),
    ).toBe(true);
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

  it("throws a combined error when both gh and HTTP fail", async () => {
    const runGh = vi.fn(async () => {
      throw new Error("gh failed");
    });
    const fetchUrl = vi.fn(async () => new Response("nope", { status: 500 }));

    await expect(
      fetchPrMetadata(PR, { runGh, fetchUrl: fetchUrl as unknown as typeof fetch }),
    ).rejects.toThrow(/gh CLI failed.*HTTP fallback failed/s);
  });

  it("rejects a malformed GITHUB_TOKEN without echoing it or sending a request", async () => {
    const runGh = vi.fn(async () => {
      throw new Error("gh failed");
    });
    const fetchUrl = vi.fn();

    const error: Error = await fetchPrMetadata(PR, {
      runGh,
      fetchUrl: fetchUrl as unknown as typeof fetch,
      githubToken: "ghp_ab\ncd",
    }).catch((e) => e);

    expect(error.message).toContain("GITHUB_TOKEN contains characters");
    expect(error.message).not.toContain("ghp_ab");
    expect(fetchUrl).not.toHaveBeenCalled();
  });
});
