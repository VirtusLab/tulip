import { describe, expect, it } from "vitest";
import { parseGitLabMrUrl } from "./mr-url.js";

describe("parseGitLabMrUrl", () => {
  it("parses host, project path and iid from a gitlab.com URL", () => {
    expect(parseGitLabMrUrl("https://gitlab.com/group/project/-/merge_requests/12")).toEqual({
      forge: "gitlab",
      host: "gitlab.com",
      repoPath: "group/project",
      number: 12,
    });
  });

  it("keeps every segment of a nested group path", () => {
    expect(
      parseGitLabMrUrl("https://git.example.com/group/sub/deeper/project/-/merge_requests/7")
        ?.repoPath,
    ).toBe("group/sub/deeper/project");
  });

  it("accepts a port and a trailing slash", () => {
    expect(
      parseGitLabMrUrl("https://git.example.com:8443/group/project/-/merge_requests/7/"),
    ).toEqual({
      forge: "gitlab",
      host: "git.example.com:8443",
      repoPath: "group/project",
      number: 7,
    });
  });

  it.each([
    "https://gitlab.com/group/project/-/merge_requests/12/diffs",
    "https://gitlab.com/project/-/merge_requests/12",
    // Looks like gitlab.com but `gitlab.com` is userinfo; the real host is evil.example.com.
    "https://gitlab.com@evil.example.com/group/project/-/merge_requests/1",
    "https://gitlab.com/group/../project/-/merge_requests/1",
    "https://gitlab.com/group/project/-/merge_requests/abc",
    "https://gitlab.com/group/project/-/merge_requests/0",
    "https://gitlab.com/group/project/-/merge_requests/12?tab=diffs",
    "https://gitlab.com/group/project/-/issues/12",
    "http://gitlab.com/group/project/-/merge_requests/12",
    "https://github.com/owner/repo/pull/1",
    "not-a-url",
    "https://gitlab.com/group/project/-/merge_requests/12#note_5",
    "https://gitlab.com/group/project/-/merge_requests/12345678901",
  ])("returns undefined for %s", (url) => {
    expect(parseGitLabMrUrl(url)).toBeUndefined();
  });
});
