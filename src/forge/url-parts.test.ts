import { describe, expect, it } from "vitest";
import { HOST_PATTERN, isValidRepoPath } from "./url-parts.js";

describe("isValidRepoPath", () => {
  it.each(["owner/repo", "group/sub/project", "my.group/my-project_2", "Group/Project"])(
    "accepts %s",
    (path) => {
      expect(isValidRepoPath(path)).toBe(true);
    },
  );

  it.each([
    "group/../project",
    "group/./project",
    "group/-/project",
    "group//project",
    "/owner/repo",
    "owner/repo/",
    "group/%2e%2e",
    "group/a\\..\\b",
    "group/pro+ject",
    "owner/repo?x=1",
    "owner/repo#x",
    "owner/re po",
  ])("rejects %s", (path) => {
    expect(isValidRepoPath(path)).toBe(false);
  });
});

describe("HOST_PATTERN", () => {
  const host = new RegExp(`^${HOST_PATTERN}$`);

  it.each(["github.com", "git.example.com:8443"])("matches %s", (value) => {
    expect(host.test(value)).toBe(true);
  });

  it.each(["github.com@evil.example.com", "host:port", "host/path"])(
    "does not match %s",
    (value) => {
      expect(host.test(value)).toBe(false);
    },
  );
});
