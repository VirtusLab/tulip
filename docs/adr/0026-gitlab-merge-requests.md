# 26. GitLab merge requests

## Context

Tulip explained only GitHub PRs. GitHub knowledge sat in four places — URL parsing, metadata
fetch, the checkout's credential helpers, and serve-mode posting — while everything from
`PrMetadata` onward (diff parsing, the LLM phases, materialization, rendering) was already
forge-neutral. Teams on GitLab, gitlab.com or self-hosted, want the same explanations for merge
requests.

## Decision

- **Forge adapter.** `PrRef` carries `forge: "github" | "gitlab"` and a single `repoPath`
  (`owner/repo`, or `group/subgroup/project`). Each forge supplies a `ForgeAdapter`: metadata
  fetch, extra git credential helpers, the auth-failure hint, the web URL and a log label.
  `parsePrUrl` and `forgeFor` (`src/forges`) are where the forge is chosen; the only other check
  is the CLI's `--serve` gate. Forge-neutral code (checkout, materialize, exec, HTTP helpers, the
  generic half of git-auth) lives in `src/forge`.
- **Detection by URL shape, not host.** `/<path>/-/merge_requests/<iid>` is GitLab on any host;
  `/<owner>/<repo>/pull/<n>` is GitHub. Path segments are allowlisted (`[A-Za-z0-9._-]+`, not
  `-`, `.` or `..`), since `repoPath` goes into the clone and API URLs. Tab suffixes such as
  `/diffs` are rejected, as `/pull/N/files` is.
- **REST only, no `glab`.** GitLab is read through API v4: the MR itself (`title`,
  `description`, branches, `diff_refs`, `changes_count`), `raw_diffs` for the unified diff and
  the paginated `/diffs` for the file list. Missing `diff_refs` (GitLab computes them
  asynchronously) is a "retry in a moment" error, raised before the other requests.
- **Revisions read around the content.** Both forges read the base/head SHAs, then the title,
  description, diff and files, then the SHAs again, and repeat the whole fetch a few times if a
  push changed them in between. The diff then always matches the head SHA the checkout uses.
  The orchestration is shared (`src/forge/pr-source.ts`); each forge supplies the two reads.
- **Token as a Bearer header.** `GITLAB_TOKEN`, when set, goes in `Authorization: Bearer` to the
  MR's host only — not GitLab's `PRIVATE-TOKEN` header, which fetch would forward across a
  cross-origin redirect while it strips `Authorization`. A token with characters that can't go in
  a header is refused without being echoed. A 401, 403 or 404 on the MR says how to set or fix
  the token.
- **Merge base as base.** `diff_refs.base_sha` is the exact pre-image of the MR diff, so the
  checkout's base files match the diff.
- **Checkout unchanged.** Both SHAs are fetched directly: Gitaly allows fetching any SHA,
  verified over HTTPS and SSH on a self-hosted instance. GitLab adds one credential helper answering
  `oauth2`/`GITLAB_TOKEN`, after the operator's own helpers. The auth-failure pattern recognizes
  GitLab's `HTTP Basic: Access denied`.
- **`--serve` stays GitHub-only** and is rejected for a GitLab URL with a usage error.
- **Prompts are forge-neutral** ("a pull request").

## Consequences

- GitLab cuts very large MR diffs at the instance's diff limits, in `/diffs` and `raw_diffs`
  alike. `changes_count` reveals it, and Tulip stops with an error instead of explaining part of
  the MR; a single oversized file is still reported by the file-list mismatch warning. Computing
  the diff locally with `git diff` would remove the limit for both forges; not done yet.
- GitLab under a relative URL root (`https://host/gitlab/...`) is not supported: the sub-path
  cannot be told apart from a group.
- `GITLAB_TOKEN` is offered to whatever host the URL names, as `GITHUB_TOKEN` is (ADR 0020).
- After a successful fetch, git hands the credential it used to the operator's own credential
  helpers to store (as it already did for `GITHUB_TOKEN`), so a `GITLAB_TOKEN` can end up in, for
  example, the macOS keychain.

## References

- ADR 0002 (checkout isolation), ADR 0019 (serve mode), ADR 0020 (fetch authentication).
