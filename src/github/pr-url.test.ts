import { describe, expect, it } from "vitest";
import { parsePrUrl } from "./pr-url.js";

describe("parsePrUrl", () => {
  it("parses owner, repo and number from a valid URL", () => {
    expect(parsePrUrl("https://github.com/owner/repo/pull/123")).toEqual({
      owner: "owner",
      repo: "repo",
      number: 123,
    });
  });

  it("accepts a trailing slash", () => {
    expect(parsePrUrl("https://github.com/owner/repo/pull/123/")).toEqual({
      owner: "owner",
      repo: "repo",
      number: 123,
    });
  });

  it.each([
    "https://gitlab.com/owner/repo/pull/123",
    "https://github.com/owner/repo/issues/123",
    "https://github.com/owner/repo",
    "not-a-url",
  ])("returns undefined for an invalid URL: %s", (url) => {
    expect(parsePrUrl(url)).toBeUndefined();
  });
});
