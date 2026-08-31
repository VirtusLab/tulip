# 8. Mermaid diagram render verification

## Context

Phase 3's explaining session (task 6.2, opus) is instructed to embed Mermaid diagrams in
```mermaid fences. Nothing checks that the LLM actually produced valid Mermaid syntax before
the markdown reaches rendering. On a real run, one diagram rendered as mermaid's own
"Syntax error in text — mermaid version 11.17.2" placeholder box in the browser: `assets/app.js`
runs `mermaid.run({ nodes, suppressErrors: true })` (see `./0004-page-layout-and-syntax-
highlighting.md`), and `suppressErrors` only stops the unhandled-promise-rejection — an invalid
diagram still gets mermaid's own error SVG drawn into the page in place of the intended one. A
reviewer-facing page should never show that.

## Decision

**Headless-validate every diagram with the exact renderer, in-process, before it ships; fix
invalid ones via the LLM; degrade gracefully if a fix doesn't land.**

1. **Fence extraction reuses `findMermaidFences`** (`src/rendering/mermaid.ts`, already used by
   the renderer) rather than a second parser — validation and rendering must always agree on
   what counts as a diagram.

2. **Validation: `src/rendering/mermaid-validate.ts`, `validateMermaidDiagram(source)`.** Imports
   the `mermaid` npm package directly (the same version `scripts/copy-assets.mjs` vendors into
   the browser bundle — see ADR 0004) and calls its own `mermaid.parse(source)` — the exact
   syntax check the client runs before drawing, so a `valid: true` here means the page will
   actually render it. `parse()` needs a `window`/`document`: mermaid's parser pulls in
   DOMPurify, which throws `DOMPurify.addHook is not a function` without one — confirmed
   empirically, and it silently false-*passed* plain flowchart/sequence diagrams while
   false-*rejecting* every classDiagram/pie/stateDiagram probed (they route through DOMPurify's
   sanitizer at parse time). Plain Node has no such globals; a `jsdom`-based vitest environment
   (the existing precedent, `highlight-safety.test.ts`) only exists in tests. The module installs
   its own minimal jsdom `window`/`document`/`SVGElement` on first use when none exist yet — so
   the same code path is exercised in production and in tests (its own test runs deliberately
   *without* `@vitest-environment jsdom`, to hit that installation branch, not paper over it).
   Verified empirically before writing the fix loop: rejects a realistic broken flowchart
   (mismatched node-shape delimiters) and garbage text; accepts valid flowchart, sequence,
   class, pie, and state diagrams; stays correct under concurrent calls (parse calls are also
   serialized via an in-process queue, defensively, since mermaid's parser/DB state is
   process-wide).

3. **Fix loop: `src/explanations/mermaid-verify.ts`, `verifyMermaidDiagrams`.** Mirrors the
   snippet-coverage verification pattern (`./coverage.ts`): for each invalid fence, resumes the
   category's *explaining* session (not a fresh one — it already has the PR/category context)
   with the invalid source and mermaid's own error message, asking for **just the corrected
   diagram source** (a new small schema, `MERMAID_FIX_SCHEMA` / `{ source }` in `./wire.ts`) —
   not the full markdown, since only one fence needs to change and regenerating the whole
   explanation risks losing unrelated content or introducing new snippet-coverage gaps. Capped
   at `config.limits.maxMermaidFixAttempts` (2) attempts per diagram, mirroring
   `maxSnippetCoverageAttempts`'s existing cap-then-give-up shape.

4. **Graceful degradation.** A diagram still invalid after every attempt is spliced out and
   replaced with `> _(A diagram was omitted here because it failed to render.)_` — never left as
   a fence, so the browser can never show its own syntax-error box — and a warning naming the
   category is logged. The rest of the explanation is untouched.

5. **Ordering: runs once, after the review-amend loop, per category** (`explainOneCategory` in
   `./orchestrate.ts`), not also right after the initial explanation. The review loop
   (task 6.4) can itself amend the markdown and thereby change a diagram, so only the *final*
   markdown — the one that actually reaches rendering — is the one that must be validated;
   validating an intermediate draft too would be redundant LLM spend for no correctness gain.
   This is why `reviewAndAmend` now returns `{ markdown, explainSessionId }` instead of a bare
   markdown string: the mermaid fix loop needs that session id to resume, and previously
   `reviewAndAmend` tracked but discarded it once review approved.

## Alternatives considered

- **Client-side only** (keep `suppressErrors: true` and rely on the placeholder box). Rejected —
  that's the exact bug being fixed; a reviewer-facing tool shipping visible internal error UI is
  not acceptable output.
- **Skip validation, just tell the LLM to be careful in the prompt.** Rejected — the whole
  premise (this ADR exists because of a real failure) is that prompting alone isn't reliable
  enough; nothing catches a slip before it ships.
- **Render server-side and screenshot/diff.** Rejected as far heavier (a headless browser or
  canvas dependency) for a task `parse()` already answers correctly; rendering is also where
  layout/theme concerns live, which are irrelevant to "is this syntactically valid."

## Consequences

- `mermaid` and `jsdom` move from devDependencies to normal dependencies — both now run during
  the pipeline, not just in tests. `mermaid`'s installed weight was already paid for the vendored
  browser bundle; `jsdom` is the one genuinely new production dependency this decision adds.
- New runtime cost per category: a `parse()` call (milliseconds) per diagram, plus — only on an
  actually-invalid diagram — up to 2 extra `claude` session turns to fix it. Categories with no
  diagrams, or only valid ones, pay just the `parse()` cost and make no extra LLM call.
- `src/rendering/mermaid-validate.ts` (+ test), `src/explanations/mermaid-verify.ts` (+ test),
  `src/prompts/explain-mermaid-fix.md`, `MERMAID_FIX_SCHEMA`/`MermaidFixResponse` in
  `./wire.ts`, `config.limits.maxMermaidFixAttempts` are new.
- `reviewAndAmend`'s return type changed (`string` → `{ markdown, explainSessionId }`); its one
  caller (`orchestrate.ts`) and its tests were updated.
