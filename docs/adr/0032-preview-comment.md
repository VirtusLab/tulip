# 32. Share the page on the PR

## Context

The page exists only on the machine that ran Tulip. Other reviewers have to run Tulip themselves,
paying for the LLM passes again, or receive the page some other way. We want one run to produce a
page every reviewer can open from the PR.

GitHub has no API for attaching a file to a comment: the browser's drag-and-drop upload uses an
internal endpoint that needs a session cookie, and `.html` isn't an accepted attachment type
anyway. The page is one file (ADRs 0030, 0033).

A first version committed previews to a `tulip-previews` branch and edited one comment in place.
Review found that every clone fetched the branch and it grew without bound; that it appeared in
the branch list, fell under branch rulesets and triggered unfiltered `on: push` workflows; that it
posted model-written text before the user had read it; that a failed upload meant re-running the
analysis; and that edits notify nobody.

## Decision

### Every run writes what sharing needs
- The run dir's `index.html` is always the static page (ADR 0030), and is what's shared. Serve
  mode's page, with its review boxes and Share button, is kept in memory and served from there.
- The page's `<head>` starts with `<meta>` tags for the PR URL, head commit, render time and an
  HMAC-SHA256 over the whole page. The key is random, per user, created on first use next to
  Tulip's settings (`share-key`, mode 0600). Keeping all this in the page, rather than in a file
  next to it, keeps the page one self-contained file: it can be moved and still shared.
- The page is rendered with 64 zeros as the signature, the HMAC is computed over that, and the
  zeros are replaced by it (same length). Verifying puts the zeros back at the same place and
  recomputes, so the signature covers every other byte; a page still holding the zeros is
  refused. Only the first matching tag in the leading `<head>` counts. The tags come before the
  PR title, the first text there Tulip doesn't control (and escapes), so nothing in the page, e.g.
  model-written markdown, can stand in for them. The other tags are read only once the signature
  checks out.
- If the key can't be created or read (e.g. a read-only home), the run writes an unsigned page,
  which can't be shared, also not by `tulip share`. It says why once, and turns sharing off: no
  Share button, no `tulip share` hint, and `--attach-preview-as-comment` doesn't try to share but
  exits non-zero.

### Three ways to share, one code path
- `--attach-preview-as-comment`: share once the run ends (after opening the page; alongside the
  server in `--serve` mode). A failed share doesn't discard the run: it exits non-zero and prints
  the `tulip share` command to retry. Ctrl+C, or stopping the server, stops the share between steps,
  and the run still cleans up.
- `tulip share <page>`: share an earlier run's page, so the user can read it first or retry. The
  page is in a temp dir the OS eventually removes, so this is for "after reading" and "retry", not
  "next week". A file can come from anyone, so the page must carry this user's signature.
  Checking the page's content instead isn't enough: the CSP pins its scripts, but not a
  `<meta http-equiv="refresh">` redirect or a full-page phishing link.
- A **Share on PR** button in `--serve` mode, when the forge can share, posting to the local
  server's `POST /api/share`.
  It has `/api/comment`'s Host and Origin guards, and also requires a JSON content type: with no
  body to validate, that is what stops a cross-site form, and a cross-site fetch with that type
  needs a CORS preflight the server never answers.
- All three publish through the same code. `tulip share` reads the page back through its
  signature, so what's shared is what Tulip rendered. Within a run, the flag and the button share
  the page the run just signed, and one memoized attempt: concurrent calls share it, a success is
  kept, a failure is forgotten so it can be retried.

### Where the file goes
- One ref per published preview, `refs/tulip/previews/pr-<n>/<preview commit sha>`, pointing at
  an orphan commit holding `tulip-pr-<n>-<head sha7>.html`, created through the Git Data API
  (`gh api`). A ref is never moved, so every comment's link keeps working while its ref exists,
  even when two people share the same PR at the same commit.
- All calls after preparing use the repo's canonical `full_name`: GitHub follows a renamed repo's
  old name (and any letter case) for reads, but answers writes with a redirect `gh` doesn't follow.
- Refs outside `refs/heads` aren't fetched by clones, aren't in the branch list, aren't covered by
  branch rulesets, and don't trigger workflows. Mirrors and `git ls-remote` still see them. On
  github.com (2026-11-17), `refs/tulip/*` refs created through the API or `git push` started no
  unfiltered `on: push` workflow, and weren't fetched by a default clone.
- The comment links the file's blob page by commit SHA, which has a **Download raw file** button.
  GitHub warns there that the commit "does not belong to any branch"; the comment explains why.
  GitHub doesn't render HTML there, and serves the raw file as text; the reviewer opens the
  downloaded file. The blob page may not display a multi-MB file, so the comment also gives a
  `gh api` command that downloads it through the contents API (`application/vnd.github.raw`
  media type, up to 100 MB, same access rules as the repo), with `--hostname` for GitHub
  Enterprise. Every value in it is checked against a strict format, so it needs no extra quoting.
- The PR's repo when the user can push to it (`permissions.push`), otherwise the user's fork,
  unless the repo reports `allow_forking: false`. A private repo's fork is private, so the preview
  is never more visible than the code. But the fork gets only the repo's team permissions, not
  individual ones: people with individual access (e.g. collaborators on a user-owned repo) can
  read the PR but not the preview. GitHub's docs don't say whether org base permissions carry over.
- Preparing is read-only (auth, repo and PR state), so it can run before the LLM work. The fork is
  created only when sharing. GitHub creates forks asynchronously (it says up to five minutes). If a
  write to the fork fails with 404/409, the share fails with GitHub's error and a hint that the
  fork may still be being created, to retry in a minute, rather than waiting. The
  preview's `gh` calls get a 10-minute timeout: the page upload is megabytes.
- Before writing, publishing checks the PR is open and still at the previewed commit. Otherwise a
  stale share would replace the newer preview as the current comment.
- No automatic pruning. It would delete other people's refs in a shared repo, including the
  previews of merged PRs, and wouldn't reliably free storage: GitHub keeps unreachable objects for
  an unspecified time, and identical inlined mermaid packs well against earlier copies. To clean
  up by hand: `git ls-remote origin 'refs/tulip/*'`, then `git push origin --delete <ref>`.

Rejected: a branch (above), a secret gist (readable by anyone with the link, which leaks private
code), a draft release asset (misuses releases), and the browser upload endpoint (undocumented and
needs a cookie).

### Comment
- The user's latest preview comment among the PR's last 100 comments is found through one
  GraphQL query: it starts with Tulip's fixed header line and ends with a hidden
  `<!-- tulip-preview {...} -->` marker. A comment that merely quotes the marker isn't matched.
- Same commit: the comment is edited in place.
- New commit: a new comment is posted, which notifies reviewers, carrying the list of earlier
  previews (up to 20). The old comment is then minimized as outdated, or, for a user who can't
  minimize (no write or triage access), edited into a pointer to the new one. Failing that is a
  warning, not a failure, since the new comment already exists. If someone already hid the latest
  comment, a new one is posted, still carrying its list of earlier previews.
- Others with write access can edit the marker JSON, and it is posted again under the user's
  name. So an earlier-preview link is only carried over when it is exactly one Tulip writes,
  `https://<host>/<repo>/blob/<commit sha>/tulip-pr-<n>-<sha7>.html`, with `<repo>` the PR's repo
  or the store repo, `<n>` this PR and `<sha7>` the entry's commit. Times are re-serialized, and
  `<`/`>` in the JSON are escaped so nothing can end the hidden comment early.
- Someone else's preview comment is never edited; the user gets their own.

## Consequences

- Push rulesets (file size or path rules), SAML SSO and token restrictions only show up when
  writing, so preparing can't promise a share will succeed; the error points at `tulip share`.
- Two runs posting the first comment at the same moment can both post one.
- GitHub only. GitLab could store the file natively (`POST /projects/:id/uploads`), but has no
  commenter yet.

## References
- ADR 0019 (serve mode) — the `gh` preflight, the local server's guards, and the other path that
  posts to the PR.
- ADR 0030 — the single-file page and its CSP.
- GitHub, "About permissions and visibility of forks" — who can read a private fork:
  https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/about-permissions-and-visibility-of-forks
