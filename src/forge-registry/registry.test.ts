import { describe, expect, it } from "vitest";
import { tokenCredentialHelper } from "../checkout/git-auth.js";
import type { PrRef } from "../forge/types.js";
import { forgeFor } from "./registry.js";

const GITHUB_PR: PrRef = {
  forge: "github",
  host: "github.com",
  repoPath: "octo/widgets",
  number: 42,
};

describe("forgeFor (GitHub)", () => {
  const adapter = forgeFor(GITHUB_PR);

  it("builds GitHub's PR URL and log label", () => {
    expect(adapter.webUrl(GITHUB_PR)).toBe("https://github.com/octo/widgets/pull/42");
    expect(adapter.label(GITHUB_PR)).toBe("octo/widgets#42");
  });

  it("keeps a self-hosted host and port in the PR URL", () => {
    const pr: PrRef = { ...GITHUB_PR, host: "git.xyz.com:8443" };
    expect(adapter.webUrl(pr)).toBe("https://git.xyz.com:8443/octo/widgets/pull/42");
  });

  it("offers gh's credential helper, then GITHUB_TOKEN's, and an auth hint", () => {
    expect(adapter.checkoutAuth.credentialHelpers).toEqual([
      "!gh auth git-credential",
      tokenCredentialHelper("GITHUB_TOKEN", "x-access-token"),
    ]);
    expect(adapter.checkoutAuth.authHint).toMatch(/gh auth login.*GITHUB_TOKEN/);
  });
});

const GITLAB_PR: PrRef = {
  forge: "gitlab",
  host: "git.example.com",
  repoPath: "group/project",
  number: 7,
};

describe("forgeFor (GitLab)", () => {
  const adapter = forgeFor(GITLAB_PR);

  it("builds GitLab's MR URL and log label", () => {
    expect(adapter.webUrl(GITLAB_PR)).toBe(
      "https://git.example.com/group/project/-/merge_requests/7",
    );
    expect(adapter.label(GITLAB_PR)).toBe("group/project!7");
  });

  it("offers a GITLAB_TOKEN credential helper and an auth hint naming the scope", () => {
    expect(adapter.checkoutAuth.credentialHelpers).toEqual([
      tokenCredentialHelper("GITLAB_TOKEN", "oauth2"),
    ]);
    expect(adapter.checkoutAuth.authHint).toMatch(/GITLAB_TOKEN.*read_repository/);
  });
});
