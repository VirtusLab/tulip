import { describe, expect, it } from "vitest";
import type { PrRef } from "../forge/types.js";
import { gitCredentialArgs as githubCredentialArgs } from "../github/git-auth.js";
import { gitCredentialArgs as gitlabCredentialArgs } from "../gitlab/git-auth.js";
import { forgeFor } from "./registry.js";

const GITHUB_PR: PrRef = {
  forge: "github",
  host: "github.com",
  repoPath: "octo/widgets",
  number: 42,
};

describe("forgeFor (GitHub)", () => {
  const forge = forgeFor(GITHUB_PR);

  it("builds GitHub's PR URL and log label", () => {
    expect(forge.webUrl(GITHUB_PR)).toBe("https://github.com/octo/widgets/pull/42");
    expect(forge.label(GITHUB_PR)).toBe("octo/widgets#42");
  });

  it("keeps a self-hosted host and port in the PR URL", () => {
    const pr: PrRef = { ...GITHUB_PR, host: "git.xyz.com:8443" };
    expect(forge.webUrl(pr)).toBe("https://git.xyz.com:8443/octo/widgets/pull/42");
  });

  it("offers GitHub's credential helpers and auth hint", () => {
    expect(forge.gitCredentialArgs("github.com")).toEqual(githubCredentialArgs("github.com"));
    expect(forge.gitAuthHint).toMatch(/gh auth login.*GITHUB_TOKEN/);
  });
});

const GITLAB_PR: PrRef = {
  forge: "gitlab",
  host: "git.example.com",
  repoPath: "group/project",
  number: 7,
};

describe("forgeFor (GitLab)", () => {
  const forge = forgeFor(GITLAB_PR);

  it("builds GitLab's MR URL and log label", () => {
    expect(forge.webUrl(GITLAB_PR)).toBe(
      "https://git.example.com/group/project/-/merge_requests/7",
    );
    expect(forge.label(GITLAB_PR)).toBe("group/project!7");
  });

  it("offers GitLab's credential helper and auth hint", () => {
    expect(forge.gitCredentialArgs("git.example.com")).toEqual(
      gitlabCredentialArgs("git.example.com"),
    );
    expect(forge.gitAuthHint).toMatch(/GITLAB_TOKEN/);
  });
});
