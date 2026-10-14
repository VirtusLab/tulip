import { describe, expect, it } from "vitest";
import { parsePrUrl } from "./pr-ref.js";

describe("parsePrUrl", () => {
  it("recognizes a GitHub PR URL", () => {
    expect(parsePrUrl("https://github.com/owner/repo/pull/123")).toEqual({
      forge: "github",
      host: "github.com",
      repoPath: "owner/repo",
      number: 123,
    });
  });

  it("returns undefined for a URL no forge recognizes", () => {
    expect(parsePrUrl("https://example.com/owner/repo/issues/1")).toBeUndefined();
  });

  it("recognizes a GitLab MR URL", () => {
    expect(parsePrUrl("https://gitlab.com/group/project/-/merge_requests/45")).toEqual({
      forge: "gitlab",
      host: "gitlab.com",
      repoPath: "group/project",
      number: 45,
    });
  });
});
