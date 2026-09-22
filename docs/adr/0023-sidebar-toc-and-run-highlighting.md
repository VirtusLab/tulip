# 23. Sidebar table of contents and run-based syntax highlighting

## Context

Two rendering problems on real pages:

1. The table of contents is `position: fixed` at the right edge, while the content is a centered
   column of up to 1500px. Between roughly 1100px and 2100px of viewport width the two overlap:
   the TOC covers prose, and diffs (which take the full content width) run under it. Below
   1100px the TOC sits inline at the top of the page, where it is no use for navigation. It is
   also tall: every category lists all of its subsections (ADR 0022), so on a PR with many
   categories the list outgrows the viewport.
2. Each diff cell is highlighted as its own one-line document (`highlightElement` per `<code>`,
   ADR 0004). Highlight.js therefore has no state between lines: a multi-line `/** ... */`
   comment is grey only on its first line, and the ` * ...` lines below get code colours.

## Decision

### A. Layout (`style.css`, `template.ts`, `assets/app.js`)

- **Sidebar column.** At 1100px and above, `body` is a two-column grid: `minmax(0, 1fr)` for
  `main` and `--toc-width` (17rem) for the TOC. The TOC is `position: sticky`, full viewport
  height, and scrolls inside; `main` keeps its `margin: 0 auto`, so the content centers inside
  the first column and never sits under the TOC.
- **Fold.** A `#toc-toggle` button next to the theme toggle folds the TOC: `html.toc-folded`
  sets the second column to `0` and hides the TOC, and `aria-expanded` tracks the state. The
  state is kept in `localStorage` (`tulip-toc-folded`), in the same way as the theme.
- **Drawer.** Below 1100px the TOC is a fixed, full-height drawer at the right edge
  (`min(20rem, 85vw)` wide), translated off-screen when folded. It starts folded, choosing an
  entry folds it again, and the fold state is not stored while the screen is narrow — a state
  saved from a phone must not hide the sidebar on the next wide screen. `app.js` reads the same
  breakpoint through `matchMedia`.
- **Accordion.** Only the category in view lists its subsections: `setActive` (the existing
  IntersectionObserver callback) marks the top-level entry containing the active link with
  `toc-current`, and CSS hides the other entries' children.

### B. Highlighting (`assets/app.js`)

- **Runs.** A run is one side's diff cells between gap rows, in document order; a blank cell
  (the other side has a line there, this one does not) is skipped without breaking the run,
  since the side's text is contiguous around it.
- **Highlight per run, split per line.** Each run's text is joined with newlines and
  highlighted once with `hljs.highlight`. The output is cut back into lines: highlight.js emits
  only `<span class="…">`, `</span>`, newlines and escaped text, so spans open at a newline are
  closed there and re-opened on the next line, and every line is a self-contained fragment
  assigned to its cell. A run is highlighted when any of its cells is new, and then as a whole:
  lines revealed by a gap expansion can change the state of the lines below them.
- **Safety.** The only HTML ever assigned to `innerHTML` is highlight.js's own output, which
  escapes every character of text; the splitter re-emits nothing but the tags highlight.js
  produced. Verified against the real bundle with a `</script><img onerror>` payload inside a
  comment (`highlight-runs.test.ts`). Prose code blocks keep `highlightElement` (ADR 0004).
- **Cap.** `MAX_HIGHLIGHT_CHARS` now applies to a whole run and is raised to 200000; a longer
  run is left as plain, escaped text.

## Consequences

- Content is 17rem narrower while the TOC is unfolded; folding gives the width back.
- A construct that starts above a snippet's first visible line is still missed: the run only
  sees the lines on the page. Expanding the gap above fixes it, since the run is redone.
- jsdom applies no `@media` rule, so `layout.test.ts` checks only the accordion and toggle
  rules; the sidebar and drawer layout have no automated test.
- ADR 0004's per-cell `highlightElement` description is amended for diff cells.

## References

- ADR 0004 (page layout rework and vendored syntax highlighting)
- ADR 0021 (merged snippets and gap expansion)
- ADR 0022 (recognized explanation sections)
