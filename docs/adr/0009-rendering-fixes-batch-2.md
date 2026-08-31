# 9. Rendering/prompt fixes from a second real-page review

## Context

The author reviewed another real Tulip-rendered page and reported four more issues: a mermaid
diagram sitting left-aligned and lost in the wide column; too much vertical whitespace, especially
around the "Original PR description" section; an added/deleted file rendering as a two-pane split
with one pane always blank; and a per-category "Coverage — Tests: ... · Docs: ..." strip that
reads as a false gap for a category that legitimately has no docs. All four are fixed here; the
page stays self-contained (no external URLs), theme-aware, and XSS-safe, and
`renderSnippetRow`'s server/client byte-identical parity (ADR 0004) is preserved.

## 1. Mermaid diagrams sit left-aligned instead of centered/full-width

**Problem:** mermaid's own renderer already scales a diagram's `<svg>` up to its natural size —
it sets `width: 100%` plus an inline `max-width: <N>px` cap (its `useMaxWidth` default; see
`node_modules/mermaid/dist/chunks/.../chunk-QJSWEUOL.mjs`'s `configureSvgSize`), so a large
diagram already grows to fill the block. But an `<svg>` is an inline-level replaced element, so
once its natural size is narrower than the container it sits flush left instead of centered — the
reported defect.

**Fix:** `main pre.mermaid { text-align: center; }` (`style.css`). `text-align: center` is the
standard way to center a narrower-than-container replaced element, and — unlike overriding the
svg's own `width`/`max-width` — it doesn't fight mermaid's own inline style, so a large diagram's
existing "grow to container width" behavior is untouched.

**Verification:** jsdom has no real layout engine, so it can't report an svg's actual rendered
pixel position (the same limitation ADR 0007's layout tests already work around). `layout.test.ts`
instead confirms the CSS mechanism directly: `getComputedStyle(pre.mermaid).textAlign` is
`"center"` in both themes (unaffected by theme, since it's a layout property), and inserting a
mock rendered `<svg style="max-width: 900px">` (simulating a large diagram) confirms this
stylesheet doesn't clobber mermaid's own inline `max-width`.

## 2. Excessive vertical whitespace, especially around the PR description

**Problem:** grid items never margin-collapse with their container's padding or with each other
(unlike normal block flow — ADR 0007's amendment already hit this once, for `h2` vs.
`.page-section`'s own padding). Every top-level child of `#pr-header`/`.page-section`/`.subsection`
is a grid item, so each one's own margin fully stacked against its neighbors' instead of
collapsing: `main`'s 6rem bottom padding, `.page-section`'s 2rem padding, `h2`'s 2.5rem
margin-top, and every paragraph/list/blockquote/pre's plain UA margin (never reset) all added up
independently. `.category-description`/`.section-note`'s `-0.25rem` hack was a symptom — a
one-off patch for one specific compounding pair, not the underlying pattern.

**Fix:** a small, consistent scale (0.5 / 1 / 1.5 / 2.5rem) replaces every previously-ad-hoc value,
plus a systematic margin reset for the compounding grid items:
- `:where(#pr-header, .page-section, .subsection) > * { margin-top: 0; margin-bottom: 0; }` zeroes
  every top-level child's margin, and `:where(...) > * + * { margin-top: 1rem; }` re-adds one
  predictable, additive rhythm (margin-top only — grid items don't collapse, so there's never a
  reason for margin-bottom to carry weight too). A heading/`.snippet`/`.subsection` etc. that needs
  a bigger jump raises its own `margin-top` with real selector specificity, which naturally wins
  over the zero-specificity `:where()` defaults.
- `h2`/`h3`'s `margin-top` dropped from 2.5rem to 1.5rem — this also tightens a markdown `##`/`###`
  subheading (e.g. "Summary"/"Notes" inside the PR description), since the rule is a plain tag
  selector, not section-boundary-specific.
- `.page-section > h2:first-child, .subsection > h3:first-child { margin-top: 0; }` (extending
  ADR 0007's existing `h2:first-child` fix to `h3`, which had the identical bug for a subsection's
  own heading — previously unnoticed only because `h3` had no explicit `margin-top` at all, so it
  was riding the browser's ~1em UA default rather than a std out value).
- `.page-section`'s padding: 2rem → 1.5rem; `main`'s own padding: 2.5rem/6rem → 2.5rem/2.5rem.
- `.category-description`/`.section-note`: the `-0.25rem` hack → a deliberate `0.5rem` (the
  scale's tightest step) — a real "caption" value instead of a value chosen to cancel out `h2`'s
  margin-bottom.
- `.snippet`'s own `margin: 1.25rem 0` dropped entirely — it's a grid item like everything else, so
  it now gets the same margin-top-only rhythm as its siblings instead of its own hand-picked value.

**Why literals, not `var()`, for the two padding declarations:** jsdom's CSS engine (used by
`layout.test.ts`'s computed-style checks, the same testing approach ADR 0007 established) resolves
`var(...)` correctly inside a plain longhand declaration like `margin-top` — the literal token is
preserved and comparable — but not inside a shorthand `padding` that mixes a custom property with
another value; that resolves to `0`, an unresolvable value silently discarded, not what a real
browser does. `main`'s and `.page-section`'s padding are therefore literal rem values (documented
in the CSS as matching the scale), keeping the existing computed-style test methodology meaningful
rather than switching to a regex/text check that ADR 0007 already showed can't catch a real cascade
bug.

**Verification:** `layout.test.ts` asserts, against a real rendered page and the real `style.css`
loaded into jsdom: a category/PR-description heading's `margin-top` is `0px` (first child, no
doubling against the section's padding); `.category-description`'s `margin-top` is the tight
`0.5rem` step, distinct from an ordinary paragraph's `1rem` rhythm step; `.subsection`'s own
`margin-top` is the bigger `1.5rem` step; a subsection's own `h3` is `0px` (no doubling against
`.subsection`'s margin); and no top-level child ever carries a `margin-bottom`.

## 3. An added/deleted file renders as a two-pane split with one pane always blank

**Problem:** `FileDiffData` (`file-diffs.ts`) carried only `{ rows, embeddable }` — no file
status — so `snippets.ts` always rendered both a base and a head pane, github split-diff style.
For a genuinely modified file this is correct, but a new file (e.g. `docs/json.md`, status
`"added"`) has no base content, so `buildAlignedDiff("", head)` already produces rows where every
`baseType`/`baseText` is `null` — the *data* was already right, the renderer just always drew an
empty pane for it anyway. Likewise a deleted file's rows have every `headType`/`headText` null.

**Fix:** threaded the file's status (`FileDiff.status` from `src/diff/change.ts` — already parsed
by `parseDiff`, just never reached rendering) end to end: `pipeline/run.ts` builds a
`Map<path, FileStatus>` from the parsed diff (mirroring the existing `renamedFrom` map for
renames) and passes it into `renderExplanations` → `loadFileDiffs`, which stores it as
`FileDiffData.status` (optional; a hand-built test fixture that doesn't set it defaults to
`"modified"`, i.e. the pre-existing two-pane behavior — no test churn required for that).
`snippets.ts` derives a `SnippetPaneMode` (`paneModeForStatus`) from the status: `"added"` →
`"head-only"` (single pane, head lines, all "+"); `"removed"` → `"base-only"` (single pane, base
lines, all "-"); `"modified"`/`"renamed"` → `"split"` (unchanged two-pane). `renderSnippetRow`
takes this mode and emits only the relevant side's three `<td>`s (line-no/marker/code) — not blank
cells for the other side, so the single-pane table never has an empty column to size. The
`+`/`-` marker gutter (ADR 0007) still renders correctly, since it's driven by the same per-cell
`baseType`/`headType` as before.

The container carries the resolved mode as `data-pane-mode`, and the client mirror in `app.js`
reads it so `expandUp`/`expandDown` (context expansion, no server round-trip) render newly-revealed
rows in the same pane mode — kept byte-identical to the server's `renderSnippetRow` via the
existing parity test, now run across all three pane modes.

A pure rename with no content change (rare) still gets a two-pane split — both sides have real
content there, so there's no blank-pane problem to fix; only added/removed genuinely have an
empty side.

**Verification (the author's explicit question):** a deleted file renders correctly — a single
pane, base-revision content, every row a "-" removal, no dangling empty head column. Confirmed via
`snippets.test.ts`'s new "renders a deleted file as a single base-only pane" case (3 `<td>`s per
row, no `.snippet-cell-head` at all) plus an end-to-end `render.test.ts` case for the added-file
path (`data-pane-mode="head-only"` present in the assembled page, no `snippet-cell-base` anywhere).

## 4. The per-category "Coverage — Tests: ... · Docs: ..." strip reads as a false gap

**Problem:** ADR 0003 introduced this strip so a category's explanation conveyed tests/docs
presence even when it skipped a "## Tests"/"## Documentation" section entirely. In practice,
though, a category legitimately narrow in scope (e.g. a one-line internal helper) has no docs to
speak of — "Docs: none" then reads as a call-out of a missing gap, not a neutral fact, misleading
the reviewer.

**Fix:** dropped the strip instruction from `explain.md` (the "Coverage — Tests: added · Docs:
none" example line and its surrounding "write 'none' for a facet with nothing here" instruction),
and the matching review-checklist bullet from `review.md` ("is there a coverage strip, and does it
match the changes..."). The conditional `## <main>`/`## Tests`/`## Documentation` sections
themselves are untouched — ADR 0003's other decision (functional-partition categories, tests/docs
riding along with their code, not split out as their own categories) stands; only the per-category
strip it also introduced is removed. A section's absence already conveys "this group didn't touch
that facet" without an explicit "none" needing to say so.

Out of scope here (the author said "maybe"): a page-level/overall coverage summary. Not added.

## Amendment: CSS review found item 2 didn't fully land

A follow-up CSS review found the whitespace fix (item 2) missed the exact spot the author's
screenshot flagged, plus two smaller cracks in the "margin-top only" invariant item 2 claims.
Fixed all three; details below. **This also corrects item 2's own overclaim** ("there's never a
reason for margin-bottom to carry weight too" / "no top-level child ever carries a
margin-bottom") — both were true of the categories/subsections the initial pass tested against,
but not of the page as a whole, for the reasons below.

### 1 (the one that mattered) — the header→"Original PR description" gap was still ~3.5rem

**Problem:** `#pr-header` sits *outside* the three grid containers item 2's margin-top-only
rhythm covers (`#pr-header` is one of those three containers, not a child of one) — its own
`margin-bottom: 2rem` was untouched by the item 2 pass entirely, and was never on the spacing
scale to begin with (2rem matches none of `--space-1`…`--space-4`). Combined with
`.page-section`'s own `padding-top: 1.5rem`, the gap between the header's bottom border and the
"Original PR description" heading was `2rem + 1.5rem = 3.5rem` — the single largest gap on the
page, and exactly what the author's screenshot showed.

**Fix:** `#pr-header { margin-bottom: var(--space-2); }` (was the off-scale `2rem`). The gap is
now `1rem + 1.5rem = 2.5rem` — a 29% reduction, and no longer an outlier (`main`'s own top/bottom
padding is 2.5rem too).

### 2 — `h1`/`.subsection h3` each carried their own margin-bottom, contradicting the rhythm rule

**Problem:** `#pr-header h1 { margin-bottom: 0.5rem; }` and `.subsection h3 { margin-bottom:
0.5rem; }` both predate item 2's `:where(...) > * { margin-bottom: 0; }` reset and won against it
on selector specificity, quietly reintroducing the exact "two independently-sized declarations
control one gap" bug item 2 otherwise eliminated (grid items don't collapse, so a real
`margin-bottom` here added directly to the next sibling's own `margin-top`).

**Fix:** deleted both — the next sibling's `margin-top` (already `var(--space-2)` via the
`:where(...) > * + *` rhythm rule) now governs each gap alone, same as everywhere else. The
`h1`→`.pr-link` and `h3`→body gaps both tighten slightly (1.5rem → 1rem) as a result — reasonable
for a title-to-byline gap and a subsection-heading-to-body gap, and consistent with the general
paragraph rhythm rather than a bespoke value.

### 3 — `h4` had no heading-jump margin-top

**Problem:** `h4` shares `h1`-`h3`'s heading typography (line-height/weight/letter-spacing) but,
unlike `h2`/`h3`, never got a `margin-top` in the original item 2 pass — a markdown `####`
subheading read with only the general paragraph rhythm above it, under-weighted relative to its
own visual size.

**Fix:** `h4 { margin-top: var(--space-3); }`, matching `h3`. No `:first-child` zeroing needed —
unlike `h2`/`h3`, `template.ts` never emits a literal `h4` as a container's own heading, so a
markdown-produced `h4` is never a top-level grid container's first child.

**Verification:** `layout.test.ts` gained a case asserting `#pr-header`'s `margin-bottom` is
`var(--space-2)` (not the old `2rem`) and `.page-section`'s `padding-top` computes to `24px`
(1.5rem) — the 2.5rem combined gap — plus extended the existing "no top-level child carries a
margin-bottom" case to `#pr-header > h1` and `.subsection > h3`. Confirmed against a regenerated
sample (`scripts/gen-sample.ts`): the assembled page's copied `assets/style.css` shows
`#pr-header { margin-bottom: var(--space-2); }` and no `#pr-header h1`/`.subsection h3` rules at
all.

## Consequences

- `style.css` gains a documented 4-step spacing scale (0.5/1/1.5/2.5rem); a future top-level
  addition to `#pr-header`/`.page-section`/`.subsection` gets its vertical rhythm for free from
  the `:where(...) > * + *` default, rather than needing its own margin choice.
- `FileDiffData` gained an optional `status` field and `RenderInput`/`loadFileDiffs` gained an
  optional `fileStatuses` map — existing callers that don't pass it keep today's two-pane
  behavior unchanged.
- `renderSnippetRow`/its `app.js` mirror gained a `paneMode` parameter; the byte-identical parity
  test (ADR 0004) now runs across `"split"`/`"head-only"`/`"base-only"`.
- Prompt-string-only change to `explain.md`/`review.md`; `explain-default.txt` and its sibling
  file snapshots (ADR 0006) were regenerated via `vitest -u`.

## References

- ADR 0007 (rendering refinements) — the grid/margin-collapse behavior this ADR's item 2 builds
  on, and the `h2:first-child` fix item 2 extends to `h3`.
- ADR 0003 (attention-based category slicing) — introduced the per-category coverage strip this
  ADR's item 4 removes; its functional-partition decision is otherwise unchanged.
- ADR 0004 (page layout and syntax highlighting) — `renderSnippetRow`'s server/client
  byte-identical parity, extended here to cover pane modes.

## Regenerating a sample page for visual inspection

```
node scripts/copy-assets.mjs   # once, to populate src/rendering/assets/vendor/*
npx tsx scripts/gen-sample.ts  # prints file://<path>/index.html — open in a browser
```
