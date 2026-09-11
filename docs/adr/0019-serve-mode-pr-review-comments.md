# 19. Serve mode: post per-category PR review comments

## Context

Tulip renders a static page and exits. A reviewer reading it must leave for GitHub to comment.
We want a box after each category that posts a PR comment. But the page is a static file
(`file://`) with no backend, and posting needs auth — a static artifact can't post. Putting a
token in a page field is a non-starter (credential handling). `gh` is already a dependency and is
authenticated per host.

## Decision

An opt-in `--serve` mode runs a localhost server that hosts the page and posts comments through
`gh`. Without the flag, behavior is unchanged: a static page, no boxes.

### CLI
- `--serve` (boolean). Off: today's behavior. On: preflight, then server + boxes.
- **Preflight:** `gh auth status --hostname <pr.host>` at the very start; on failure, exit with a
  clear message before any fetch/LLM work — posting has no fallback, so a broken `gh` makes serve
  pointless.

### Server (`src/serve`)
- Node `http` server bound to `127.0.0.1` on an OS-assigned port, serving the render temp dir
  (`index.html` + `assets/`), guarded against path traversal. Opens the `http://127.0.0.1:<port>`
  URL (unless `--no-open`) and runs until SIGINT, then closes and returns so the normal cleanup
  runs.
- `POST /api/comment` with `{ categoryIndex: number, text: string }`. The PR ref is fixed to the
  launched PR — a request can't name another repo/PR. `categoryIndex` is validated against the
  server's own ordered category-name list; `text` is trimmed, required non-empty, and rejected
  over a length cap (kept under GitHub's 65536-char comment limit, well under ARG_MAX). The body
  is built server-side as `**<category name>**\n\n<text>` and posted via
  `gh pr comment <prUrl> --body <body>` (arg array, no shell — injection-safe). Responds
  `{ url }` (the created comment) or `{ error }`.
- **CSRF / rebinding guard:** reject any request whose `Host` isn't `127.0.0.1:<port>`, and any
  POST whose `Origin` header is present and not the server's own origin — so a random site the
  reviewer has open can't drive the endpoint (the random port already makes it hard to target).
  The request body read is size-bounded.

### Page
- With serve on, `renderCategorySection` emits a review box after each category body: a
  `<textarea>`, a "Post to GitHub" button, and a status line. Client JS (`app.js`) POSTs
  `{ categoryIndex, text }` to `/api/comment`, shows posting / posted (with a link) / error, and
  clears the textarea on success. In static mode no boxes render; the same `app.js` finds none
  (no-op), so the asset is unchanged.

### Posting model
- Each box submission posts one comment immediately (not batched). Re-submitting posts another.

## Consequences

- A new long-running mode: the process stays up until Ctrl+C; the temp dir is kept (as today).
- Fixes a latent bug: `run.ts` rebuilt the PR URL as `github.com/...`; it now uses `pr.host`, so a
  self-hosted PR gets the right URL for both the page link and posting.
- `src/github` gains a `pr comment` wrapper and a `gh auth status` preflight; `src/serve` is a new
  package. Rendering gains one boolean; no LLM/prompt changes.

## References
- ADR 0011 (auto-open) — serve opens the `http://` URL instead of `file://`.
- Self-hosted host support — reuses `pr.host` for the URL and the preflight `--hostname`.
