import { describe, expect, it } from "vitest";
import { parseGitHubPrUrl } from "./pr-url.js";

describe("parseGitHubPrUrl", () => {
  it("parses host, repo path and number from a github.com URL", () => {
    expect(parseGitHubPrUrl("https://github.com/owner/repo/pull/123")).toEqual({
      forge: "github",
      host: "github.com",
      repoPath: "owner/repo",
      number: 123,
    });
  });

  it("parses a self-hosted GitHub Enterprise URL", () => {
    expect(parseGitHubPrUrl("https://git.xyz.com/owner/repo/pull/7")).toEqual({
      forge: "github",
      host: "git.xyz.com",
      repoPath: "owner/repo",
      number: 7,
    });
  });

  it("accepts a port in a self-hosted host", () => {
    expect(parseGitHubPrUrl("https://git.xyz.com:8443/owner/repo/pull/7")?.host).toBe(
      "git.xyz.com:8443",
    );
  });

  it("accepts a trailing slash", () => {
    expect(parseGitHubPrUrl("https://github.com/owner/repo/pull/123/")).toEqual({
      forge: "github",
      host: "github.com",
      repoPath: "owner/repo",
      number: 123,
    });
  });

  it.each([
    "https://github.com/owner/repo/issues/123",
    // Looks like github.com but `github.com` is userinfo; the real host is evil.example.com.
    "https://github.com@evil.example.com/owner/repo/pull/1",
    "https://github.com/owner/repo",
    "https://github.com/owner/repo/pull/0",
    "https://github.com/a/b?x=1/pull/1",
    "https://host/../repo/pull/1",
    "https://github.com/a/%2e%2e/pull/1",
    "https://gitlab.com/group/project/-/merge_requests/1",
    "not-a-url",
  ])("returns undefined for an invalid URL: %s", (url) => {
    expect(parseGitHubPrUrl(url)).toBeUndefined();
  });
});
