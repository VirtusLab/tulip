# TODO

Remaining tasks, roughly by priority.

## Security / robustness
- [ ] Restrict the spawned `claude` process's tools (e.g. `--disallowedTools Edit,Write,Bash` or a read-only permission mode) — today it inherits the user's permission config and can modify files if the user pre-allowed those tools
- [ ] Aggregate page-embed budget: the 200KB context-embed cap is per file per side; a many-file PR can still produce a very large page
- [ ] Reject protocol-relative (`//host`) URLs in prose links (inert under `file://`, still worth closing)

## Configuration
- [ ] Central config module for models (per phase), timeouts, retry/cap counts, batch/excerpt/embed sizes — currently constants scattered across modules; optionally expose via CLI flags/env

## Features (deferred from spec)
- [ ] Checkpointing & resumability of a partially-completed run (spec: "a later concern")
- [ ] Surface per-run LLM cost (envelopes carry `total_cost_usd`; sum and log it)
- [ ] Category-level progress for phase 3 in non-verbose mode is minimal; consider a progress line per review round

## Validation
- [ ] Live E2E re-run (the only live run predates the final fix wave: cwd threading, timeouts, rename handling)
- [ ] Manual browser check of a generated page (mermaid rendering, expand/collapse, theme toggle have never run in a real browser)

## Cosmetic / test-shape (from review ledger)
- [ ] Extract shared change-location formatter (duplicated one-liner in the two coverage error messages)
- [ ] Boundary-value tests for the 200KB embed cap; split a few multi-assertion tests
- [ ] Owner/repo charset allowlist in PR-URL parsing (defense-in-depth)
