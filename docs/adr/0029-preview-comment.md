# 29. Share the page on the PR

## Context

The page exists only on the machine that ran Tulip. Other reviewers have to run Tulip themselves,
paying for the LLM passes again, or receive the page some other way. We want one run to produce a
page every reviewer can open from the PR.

GitHub has no API for attaching a file to a comment: the browser's drag-and-drop upload uses an
internal endpoint that needs a session cookie, and `.html` isn't an accepted attachment type
anyway. The page is also not one file but `index.html` plus about 3.8 MB of `assets/`.

A first version committed previews to a `tulip-previews` branch and edited one comment in place.
Review found that every clone fetched the branch and it grew without bound; that it appeared in
the branch list, fell under branch rulesets and triggered unfiltered `on: push` workflows; that it
posted model-written text before the user had read it; that a failed upload meant re-running the
analysis; and that edits notify nobody.

## Decision

### Every run writes what sharing needs
- `renderExplanations` also writes `standalone.html`: the same static page (never serve mode's
  review boxes or Share button) with the stylesheet, scripts and fonts inlined, fonts as `data:`
  URLs. About 4 MB, nearly all of it mermaid.
- The CSP keeps its deny-by-default shape, but allows scripts by the SHA-256 of each inlined
  script instead of `'self'`, and fonts from `data:`. Model-written markup still can't run a script
  or fetch a URL.
- `</script` and `<!--` in the inlined JS are written as `<\/script` and `<\x21--`. In JS they only
  occur in strings, regexes (`/u` ones included) and comments, where the escape means the same.
  Line endings are made LF first, as the browser does before hashing a script for the CSP.
- `tulip-run.json` records the PR URL, head commit and render time, with an HMAC-SHA256 over them
  and the single-file page. The key is random, per user, created on first use next to Tulip's
  settings (`share-key`, mode 0600).

### Three ways to share, one code path
- `--attach-preview-as-comment`: share once the run ends (after opening the page; alongside the
  server in `--serve` mode). A failed share doesn't discard the run: it exits non-zero and prints
  the `tulip share` command to retry. Ctrl+C, or stopping the server, stops the share between steps
  and during a wait for a new fork, and the run still cleans up.
- `tulip share <run dir>`: share an earlier run, so the user can read the page first or retry. The
  run dir is a temp dir the OS eventually removes, so this is for "after reading" and "retry", not
  "next week". A directory can come from anyone, so the run must carry this user's signature
  over the page and the manifest. Checking the page's content instead isn't enough: the CSP pins
  its scripts, but not a `<meta http-equiv="refresh">` redirect or a full-page phishing link.
- A **Share on PR** button in `--serve` mode, when the forge can share, posting to the local
  server's `POST /api/share`.
  It has `/api/comment`'s Host and Origin guards, and also requires a JSON content type: with no
  body to validate, that is what stops a cross-site form, and a cross-site fetch with that type
  needs a CORS preflight the server never answers.
- All three publish through the same code, and all three read the page back through the run's
  signature, so what's shared is what Tulip rendered. Within a run, the flag and the button share one
  memoized attempt: concurrent calls share it, a success is kept, a failure is forgotten so it can
  be retried.

### Where the file goes
- One ref per published preview, `refs/tulip/previews/pr-<n>/<preview commit sha>`, pointing at
  an orphan commit holding `tulip-pr-<n>-<head sha7>.html`, created through the Git Data API
  (`gh api`). A ref is never moved, so every comment's link keeps working while its ref exists,
  even when two people share the same PR at the same commit.
- All calls after preparing use the repo's canonical `full_name`: GitHub follows a renamed repo's
  old name (and any letter case) for reads, but answers writes with a redirect `gh` doesn't follow.
- Refs outside `refs/heads` aren't fetched by clones, aren't in the branch list, aren't covered by
  branch rulesets, and don't trigger workflows (all checked on github.com). Mirrors and `git
  ls-remote` still see them.
- The comment links the file's blob page by commit SHA, which has a **Download raw file** button.
  GitHub warns there that the commit "does not belong to any branch"; the comment explains why.
  GitHub doesn't render HTML there; the reviewer opens the downloaded file.
- The PR's repo when the user can push to it (`permissions.push`), otherwise the user's fork,
  unless the repo reports `allow_forking: false`. A private repo's fork inherits its access, so a
  preview of private code is only readable by people who can read the code.
- Preparing is read-only (auth, repo and PR state), so it can run before the LLM work. The fork is
  created only when sharing. GitHub creates forks asynchronously (it says up to five minutes), so
  the first write to a fork GitHub reports as created in the last ten minutes is retried on
  404/409 with backoff, for up to five minutes. An older fork's 404 is reported at once. The
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
- The user's latest preview comment among the PR's last 100 comments is found by a hidden
  `<!-- tulip-preview {...} -->` marker, through one GraphQL query.
- Same commit: the comment is edited in place.
- New commit: a new comment is posted, which notifies reviewers, carrying the list of earlier
  previews (up to 20). The old comment is then minimized as outdated, or, for a user who can't
  minimize (no write or triage access), edited into a pointer to the new one. Failing that is a
  warning, not a failure, since the new comment already exists. If someone already hid the latest
  comment, a new one is posted, still carrying its list of earlier previews.
- Others with write access can edit the marker JSON, and it is posted again under the user's
  name. So earlier-preview links are only carried over when they point into the PR's repo or the
  store repo and a browser wouldn't rewrite them (no `..` segments), times are re-serialized, and
  `<`/`>` in the JSON are escaped so nothing can end the hidden comment early.
- Someone else's preview comment is never edited; the user gets their own.

## Consequences

- Every run writes about 4 MB more to its temp dir.
- Push rulesets (file size or path rules), SAML SSO and token restrictions only show up when
  writing, so preparing can't promise a share will succeed; the error points at `tulip share`.
- Two runs posting the first comment at the same moment can both post one.
- GitHub only. GitLab could store the file natively (`POST /projects/:id/uploads`), but has no
  commenter yet.

## References
- ADR 0019 (serve mode) — the `gh` preflight, the local server's guards, and the other path that
  posts to the PR.
- ADR 0028 — the page's CSP.
