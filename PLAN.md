# Project Tulip — Development Plan / Issue Tracker

**Goal:** CLI tool (`tulip <PR URL>`) that analyzes a GitHub PR with LLMs and renders a reviewer-friendly HTML explanation.

**Spec:** `docs/adr/0001-initial-spec.md`. Epics are listed in implementation order. Mark tasks `[x]` when done.

**Tech stack:** TypeScript, Node (latest LTS), pnpm, vitest. LLM via `claude -p` headless.

**Non-goals (for now):** checkpointing & resumability.

---

## Epic 1: Project scaffolding
- [x] 1.1 Init TypeScript project: pnpm, tsconfig, vitest, lint/format
- [x] 1.2 CLI entry point: parse `tulip <PR URL>` invocation, validate args; flags for configurable options (diff-vs-reference threshold)
- [x] 1.3 Logging utility (phase/progress reporting, reasonable verbosity)

## Epic 2: PR fetching & change model
- [x] 2.1 Parse PR URL into owner/repo/number
- [x] 2.2 Fetch PR metadata (title, description, file list, diff) via `gh`; http fallback when `gh` unavailable
- [x] 2.3 Temporary git checkout containing base & head revisions
- [x] 2.4 Diff parser: produce the change model (file + line ranges, additions/removals/deletions, base/head side addressing)
- [x] 2.5 Unit tests against fixture PRs/diffs

## Epic 3: Claude CLI integration layer
- [x] 3.1 Wrapper for `claude -p` headless runs: model selection, structured output via JSON schema, result parsing
- [x] 3.2 Session management: create, resume
- [x] 3.3 Concurrency limiter (max 3 parallel sessions)
- [x] 3.4 Shared prompt preamble (short, simple language, no jargon)
- [x] 3.5 Tests with a mocked `claude` binary

## Epic 4: Phase 1 — category generation
- [x] 4.1 Prompt + JSON schema: PR title/description/file list → ordered category list (sonnet)
- [x] 4.2 Keep session handle for later consultation (escape hatch in phase 2)
- [x] 4.3 Tests for prompt construction & response handling

## Epic 5: Phase 2 — change classification
- [x] 5.1 Prompt + JSON schema: change → (category+, code type) mapping (haiku), incl. "ignore" and "none + suggested category"; ignored changes excluded from all later phases and rendering
- [x] 5.2 Escape hatch flow: consult phase-1 session on suggested category; accept (continue with updated list) or reject (re-ask)
- [x] 5.3 Coverage verification: all non-ignored lines covered; re-ask classifier for missing changes
- [x] 5.4 Tests: classification flow, escape hatch, coverage repair

## Epic 6: Phase 3 — category explanations
- [x] 6.1 Snippet-reference markup: file + side (base/head) + line range + unfold flag; parser for it
- [x] 6.2 Per-category prompt (opus, fresh session): context, diffs vs. file+range refs by configurable threshold, explanation structure per spec
- [x] 6.3 Snippet coverage verification: all provided changes referenced; resume session to amend missing ones
- [x] 6.4 Review subagent: clarity/conciseness/correctness; fix & re-review loop, max 3 rounds
- [x] 6.5 Tests: markup parsing, coverage check, review loop control

## Epic 7: Rendering
- [x] 7.1 Static HTML template: light/dark theme toggle, floating TOC, programmer font, narrow layout; bundled assets (no network)
- [x] 7.2 Mermaid diagram rendering
- [x] 7.3 Snippet substitution: markup refs → side-by-side unfoldable diffs with expandable context (github-style), honoring the unfold-by-default flag
- [x] 7.4 Output assembly: temp directory with HTML page + open-in-browser instructions
- [x] 7.5 Tests: template rendering, snippet substitution

## Epic 8: End-to-end integration
- [x] 8.1 Pipeline orchestration: wire phases 1–3 + rendering, progress logging throughout
- [x] 8.2 Error handling: missing `claude`, fetch failures, malformed LLM output
- [x] 8.3 E2E run against a real public PR; iterate on prompts/output quality
- [x] 8.4 README: install, prerequisites, usage
