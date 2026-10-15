import { describe, expect, it } from "vitest";
import { tokenCredentialHelper } from "../forge/git-auth.js";
import { gitCredentialArgs } from "./git-auth.js";

describe("gitCredentialArgs", () => {
  it("adds gh's helper, then a GITHUB_TOKEN helper with GitHub's token username", () => {
    const key = "credential.https://git.example.test.helper";

    expect(gitCredentialArgs("git.example.test")).toEqual([
      "-c",
      `${key}=!gh auth git-credential`,
      "-c",
      `${key}=${tokenCredentialHelper("GITHUB_TOKEN", "x-access-token")}`,
    ]);
  });
});
