# 7. Rendering refinements from a real-page review

## Context

The author reviewed a real Tulip-rendered page (a softwaremill/jox PR touching
`Flow.java`) and reported five rendering defects. This ADR covers the four with a code
fix (a mermaid-verification note was deferred to a later unit — see progress.md). All
changes are in `src/rendering` (+ the minimal `src/explanations/markup.ts`-adjacent
threading needed for item 6); the page stays self-contained (no external URLs),
theme-aware, XSS-safe, and `renderSnippetRow`'s server/client byte-identical parity
(ADR 0004) is preserved.

## 1. Headings misalign left of body text

**Problem:** `style.css` centered each prose element independently
(`main :is(p, ul, ol, ...) { max-width: var(--prose-measure); margin-inline: auto; }`).
The selector is a *descendant* selector, so it re-applied to nested elements too (e.g. a
list nested inside a `blockquote`, whose own padding narrows its available width) —
each such element then auto-centered itself within its own, narrower parent, drifting
its left edge away from its siblings'.

**Fix:** Replaced per-element centering with a shared 3-track CSS grid
(`minmax(0,1fr) min(var(--prose-measure),100%) minmax(0,1fr)`) applied to each *content
container* (`#pr-header`, `#pr-description`, `.category`, `.subsection`) — not to
individual prose elements. Grid item placement only affects **direct children**, so
only one level of children is ever positioned; nested elements (a list inside a `li`, a
paragraph inside a `blockquote`) simply flow inside their parent's box, which is what
fixed the drift. Every direct child defaults to the center track (`grid-column: 2`);
`.snippet` and prose `pre` (fenced code) opt out to the full span (`grid-column: 1 /
-1`) for full-width breakout, matching ADR 0004's original intent. `.subsection` itself
also spans full width inside its parent `.category` grid, so it can host its own
identically-sized nested grid — since none of these containers constrain their own
width, every grid's center track computes to the same pixel offset, so headings,
paragraphs, and lists all share one left edge. No `100vw`/negative-margin breakout is
used (ADR 0004 already rejected that for its scrollbar-width gotcha); grid handles
full-bleed without it. `main` itself is untouched (still capped at `--page-max-width`,
unconstrained-width children) — responsiveness comes for free from `min()`/`minmax()`,
no extra media query needed.

## 2. The PR's original description isn't marked as its own section

**Problem:** `template.ts` rendered `input.prDescription` in a bare
`<div class="pr-description">` inside `#pr-header`, with no heading, no id, and no TOC
entry — indistinguishable from page furniture, and easy to mistake for Tulip's own
analysis.

**Fix:** Moved it out of `#pr-header` into its own `<section id="pr-description">`,
labeled `<h2>Original PR description</h2>` followed by a one-line note
(`.section-note`, styled like `.category-description`) that it's the PR author's own
text, not Tulip's analysis. `buildToc` (`toc.ts`) now always prepends a fixed
`{ id: "pr-description", label: "PR description" }` entry before the per-category
entries, so it's the first thing in the floating TOC — the reader item sees this before
the (Tulip-generated) analysis sections. The section shares `.category`'s grid/padding/
border styling via a new `.page-section` class (kept separate from `.category` itself
so existing "one section per category" counts are unaffected).

## 3. *(mermaid live-render verification — deferred, not in this ADR's scope)*

## 4. Diff fragments don't show which lines are added/removed

**Problem:** `renderSnippetRow` (`snippets.ts`, mirrored in `assets/app.js`)
distinguished add/remove/context rows by background-color class only
(`cellTypeClass`) — easy to miss, and a context-only region (e.g. from a base-load
issue) would look identical to a real "no changes here" run.

**Fix:** Added an explicit marker gutter cell per side: base side renders `-` for a
`remove` row (blank otherwise), head side renders `+` for an `add` row (blank
otherwise) — GitHub split-diff style, in addition to the existing background color. Both
`renderSnippetRow` (server, `snippets.ts`) and its hand-maintained mirror in
`assets/app.js` were updated identically, keeping the byte-identical parity
`snippets.test.ts` asserts (client-side context expansion re-renders rows from the same
function). `.snippet-marker` is narrow, muted, and `user-select: none` so
copy-pasting a diff row's code doesn't pick up the marker character.

**Base-vs-head verification:** Traced the data path a modified file's snippet takes —
`createCheckout`'s `getFileAtBase`/`getFileAtHead` (`src/github/checkout.ts`) each run
`git show <sha>:<path>` independently per revision, and `buildAlignedDiff`
(`line-diff.ts`) runs `diffLines` over the two independently-fetched strings. For a
genuinely modified file (exists at both revisions), this produces real `add`/`remove`
rows — there's no base-load/context-only failure mode in this codebase's current code
(the real page that prompted this report, a jox PR touching `Flow.java`, isn't
reproducible from this repository, so this is a code-path trace, not a re-run of that
exact page). The reported "no markers" symptom is fully explained by the missing-gutter
defect above — a real add/remove row *was* being colored correctly, just without an
explicit marker to catch the eye. No separate data-layer bug found or fixed.

## 5. Docs/prose diffs force horizontal scroll instead of wrapping

**Problem:** `.snippet-scroll` used `overflow-x: auto` over `white-space: pre` cells
unconditionally — correct for code (alignment matters), but a long markdown/prose line
just scrolled instead of wrapping, which is not how the author reads prose diffs.

**Fix:** `renderSnippetBlock` (`snippets.ts`) now also classifies the file's guessed
language (`language.ts`) as prose-like — markdown, or no recognized code language at
all (`isProseLanguage`) — and adds a `snippet-wrap` class to `.snippet-scroll` in that
case. CSS targets `.snippet-wrap .snippet-table` with `table-layout: fixed` and its code
cells with `white-space: pre-wrap; overflow-wrap: anywhere`, so long lines wrap within
the fixed-width table instead of growing it. Code files (any other guessed language)
keep the original `white-space: pre` + horizontal scroll, since alignment matters there.

## 6. Test-code snippets should default to folded

**Problem:** A snippet's open/collapsed default came only from its own `unfold` flag
(`markup.ts`/`SnippetRef.unfold`) — a test file with `unfold="yes"` rendered open by
default regardless of the surrounding subsection, cluttering the page with test code
before the reader has read the production change it covers.

**Fix:** `renderCategoryMarkdown` (`markdown.ts`) takes a new
`{ forceSnippetsCollapsed?: boolean }` option, passed through to
`renderSnippetBlock`/its `<details>` `open` attribute (`snippets.ts`) as an AND with the
ref's own `unfold`. `template.ts`'s `renderSubsection` passes
`forceSnippetsCollapsed: subsection.kind === "test"` (the kind `sections.ts` already
recognizes from the "## Test code" heading) — so every snippet inside a test subsection
renders collapsed, regardless of its own `unfold` flag, while a production subsection's
snippets keep honoring `unfold` exactly as before. The category intro and the PR
description path don't pass the option (default `false`), since neither is
attributable to a "test" subsection.

## Consequences

- `style.css`'s prose-centering rule became container-level (grid) instead of
  per-element; a future prose element added to `renderCategoryMarkdown`'s output
  doesn't need its own centering rule — it inherits the grid's default column as any
  other direct child of its container.
- `.snippet-table` rows now have 6 `<td>`s instead of 4 (line-no/marker/code per side);
  any other code reading row HTML by fixed cell position (none currently does — tests
  use class selectors) would need updating.
- `renderCategoryMarkdown`'s signature grew an options parameter; every call site now
  explicit about whether it's rendering a test subsection.
- The floating TOC always shows a "PR description" entry, even when there are no
  category explanations yet.

## Regenerating a sample page for visual inspection

No committed `gen-rich`-style script existed in the repo at the time of this unit (a
prior throwaway one lived only in a session scratchpad). A minimal one is added at
`scripts/gen-sample.ts`: builds a small but representative `PageInput` — a PR
description, a category with both a "## Production code" and "## Test code"
subsection, a modified code file (add/remove rows), a long-line markdown file, and a
long-line code file — and calls `renderPage` + `assembleOutput` directly against the
TS source (no build step required beyond the vendored assets). Run it with:

```
node scripts/copy-assets.mjs   # once, to populate src/rendering/assets/vendor/*
npx tsx scripts/gen-sample.ts  # prints file://<path>/index.html — open in a browser
```
