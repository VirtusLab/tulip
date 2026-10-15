import { describe, expect, it } from "vitest";
import { tokenCredentialHelper } from "../forge/git-auth.js";
import { GITLAB_GIT_AUTH_HINT, gitCredentialArgs } from "./git-auth.js";

describe("GitLab gitCredentialArgs", () => {
  it("adds a GITLAB_TOKEN helper with the oauth2 username", () => {
    expect(gitCredentialArgs("git.example.test")).toEqual([
      "-c",
      `credential.https://git.example.test.helper=${tokenCredentialHelper("GITLAB_TOKEN", "oauth2")}`,
    ]);
  });
});

describe("GITLAB_GIT_AUTH_HINT", () => {
  it("names GITLAB_TOKEN and the scope git needs", () => {
    expect(GITLAB_GIT_AUTH_HINT).toMatch(/GITLAB_TOKEN.*read_repository/);
  });
});
