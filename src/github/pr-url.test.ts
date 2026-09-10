import { describe, expect, it } from "vitest";
import { parsePrUrl } from "./pr-url.js";

describe("parsePrUrl", () => {
  it("parses host, owner, repo and number from a github.com URL", () => {
    expect(parsePrUrl("https://github.com/owner/repo/pull/123")).toEqual({
      host: "github.com",
      owner: "owner",
      repo: "repo",
      number: 123,
    });
  });

  it("parses a self-hosted GitHub Enterprise URL", () => {
    expect(parsePrUrl("https://git.xyz.com/owner/repo/pull/7")).toEqual({
      host: "git.xyz.com",
      owner: "owner",
      repo: "repo",
      number: 7,
    });
  });

  it("accepts a trailing slash", () => {
    expect(parsePrUrl("https://github.com/owner/repo/pull/123/")).toEqual({
      host: "github.com",
      owner: "owner",
      repo: "repo",
      number: 123,
    });
  });

  it.each([
    "https://github.com/owner/repo/issues/123",
    "https://github.com/owner/repo",
    "not-a-url",
  ])("returns undefined for an invalid URL: %s", (url) => {
    expect(parsePrUrl(url)).toBeUndefined();
  });
});
