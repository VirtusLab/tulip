# 20. Checkout fetch: use the operator's git credentials

## Context

ADR 0002 runs all of `createCheckout`'s git calls with `GIT_CONFIG_NOSYSTEM=1` and
`GIT_CONFIG_GLOBAL=/dev/null`, so a PR's `.gitattributes` can't trigger an operator-configured
filter. Credential helpers live in exactly those two config files (`gh auth setup-git` writes the
global one; macOS ships `osxkeychain` in the system one). With them gone, `git fetch` of a private
repository had no credentials and asked for a username and password on the terminal, which GitHub
no longer accepts for git over HTTPS. PR metadata had already been fetched fine via `gh`, so the
failure appeared only at the checkout step. Public repositories never hit it.

## Decision

- **`fetch` runs with the operator's normal git config.** Fetch interprets nothing from the PR:
  it applies no attributes, the working tree is still empty so there is no `.gitmodules` for
  `fetch.recurseSubmodules`, and hooks are not versioned. The isolation bought nothing there.
  This picks up whatever the operator already uses: credential helpers, credential managers, or
  an `insteadOf` rewrite to SSH.
- **`init`, `remote add`, `checkout` and `show` stay isolated.** Smudge filters run at checkout;
  none of these need the network.
- **Two helpers are appended per fetch**, scoped to `https://<PR host>` via
  `-c credential.https://<host>.helper=...`: `gh auth git-credential`, then a shell helper that
  answers with `GITHUB_TOKEN` when the variable is set. Git consults helpers in config order and
  stops at the first that answers, so the operator's own helpers come first; these fill in only
  when none of them has a credential for the host. The order (gh, then token) mirrors
  `fetchPrMetadata`. The token helper reads the variable at run time, so the token is never in a
  command line, and the host scoping keeps it from being sent anywhere but the PR's host.
- **`GIT_TERMINAL_PROMPT=0` on fetch.** Over https, no credentials means an immediate failure,
  not a terminal prompt. Only git's own prompts are affected: a configured askpass program is
  left alone, since it may be what supplies the credentials, and ssh (after an `insteadOf`
  rewrite) is the operator's transport and prompts as it always does.
- **Auth-looking failures get a hint** naming the three sources above. Matched: missing or
  rejected credentials, an HTTP 401/403, a rejected SSH key, and "not found" (the repo is known to
  exist by then; GitHub answers 404 for a private repo the credentials can't see).
- **Inputs to the fetch are checked.** Revisions must be full SHAs, since they are git operands
  and now may travel over an operator-configured SSH transport. The PR URL's host must be a bare
  hostname with an optional port, so a lookalike like `https://github.com@evil.example.com/...`
  is refused instead of receiving the operator's credentials.

## Consequences

- Private repositories work for anyone who can already `git fetch` them, or who is logged in to
  `gh`, or who has `GITHUB_TOKEN` set, including on GitHub Enterprise hosts.
- The checkout-time hardening from ADR 0002 is unchanged.
- The first helper that answers wins. An operator whose own helper holds a stale or under-scoped
  credential for the host gets an auth failure with a hint, not a silent fallback to `gh`.
- Standard git behaviour now applies to the fetch: a rejected credential is erased from the
  operator's helpers, and operator transport settings (proxies, `http.sslVerify`, SSH rewrites)
  are honoured.
- `GITHUB_TOKEN` is offered to whichever host the PR URL names, as the REST fallback already does
  for GitHub Enterprise. The tightened URL parser rules out lookalike hosts; a plainly foreign
  host in a pasted link remains the operator's call.
- `GitRunner` takes the env per call, so tests assert which steps are isolated and which are not.
