# 22. Recognized explanation sections

## Context

`splitCategoryMarkdown` (`src/rendering/sections.ts`) splits a category's explanation into
subsections, but matches only the exact own-line headings `## Production code` and
`## Test code`. ADR 0003 replaced those two mandatory headings in the explain prompt with
conditional `## ...` sections — a main section *named for what it covers*, `## Tests` if tests
changed, `## Documentation` if docs changed — and never touched the parser. Since then no heading
the model writes matches it, so on every real page the whole explanation falls into `intro` and
three features are dead: `subsectionId` (`src/rendering/ids.ts`) assigns no ids, `buildToc`
(`src/rendering/toc.ts`) adds no children to a category's TOC entry, and `renderSubsection`
(`src/rendering/template.ts`) never folds test snippets (ADR 0007 item 6). A rendered page
confirms it: headings read "What changed", "Tests"; the page has zero subsection ids.

The prompt's wording is the better half of the mismatch, so the parser follows the prompt.

## Decision

**Recognize the headings the prompt asks for, and make the section the unit of folding.**

### A. Parsing (`sections.ts`)

- Every own-line `## ...` heading outside a fenced code block starts a subsection. Fences (three
  or more backticks or tildes, any info string) are tracked while scanning, since the model
  quotes markdown and diffs, and a `## ` line inside a quoted block must not split the category.
  `#` and `###` headings are never split points; they stay in the current body.
- Kind by heading text, case-insensitive, after trimming a trailing `:` and closing `#`s:
  `Tests`, `Test`, `Testing` → `test`; `Documentation`, `Docs` → `docs`; anything else → `main`,
  carrying its own heading text. A drifted heading degrades to an open main section, which is
  readable; the short synonym list covers the likely drift.
- A category may have several `main` subsections; each is listed and rendered separately.
- Text before the first heading is the `intro`. It is the normal case, not an exception: the
  prompt asks for a big-picture lead-in that is not its own section. The intro renders open and
  unlabelled and gets no TOC entry of its own; the category entry covers it. A category with no
  `## ` heading at all is a valid page.
- `## Production code` / `## Test code` are not special-cased: no stored output uses them (pages
  are regenerated per run) and the prompt has not asked for them since ADR 0003. `## Test code`
  parses as `test` through the synonym rule; `## Production code` as a main section.
- `SubsectionKind` becomes `"main" | "test" | "docs"`.

### B. Table of contents (`toc.ts`, `style.css`)

Every subsection is listed as a child of its category, labelled by its own heading text; the
fixed kind→label map goes away. Model-chosen headings can be long, so TOC labels wrap
(`overflow-wrap: anywhere`); nesting depth stays at two levels.

### C. Folding (`template.ts`, `style.css`, `assets/app.js`)

- `test` and `docs` subsections render folded; `main` subsections render open. The main part is
  what a reviewer reads; tests and docs are there when wanted.
- Markup: a full-bleed `<details id="…" class="section-fold">` holds the heading in its
  summary (`<summary><h3>Tests</h3></summary>`, so the heading keeps its style and the document
  outline) and the ordinary `<div class="subsection subsection-test">` grid below it. The
  `<details>` cannot be the grid itself: it lays its light-DOM children out inside its own content
  box, so `display: grid` on it never reaches the paragraphs. The summary is sized to the prose
  measure and centred, which lands it where grid column 2 would. A `main` subsection is the same
  `<div class="subsection subsection-main">` as today.
- Folding is skipped when the category has no open content — no non-blank intro and no `main`
  subsection: the `test` and `docs` sections then render open, as divs, so the category never
  looks empty and the serve-mode review box (ADR 0019) sits under visible content. Accepted
  trade-off: prose the model mis-files under `## Tests` is hidden by default in the normal case.
- Navigation into a folded section: `app.js` opens every closed `<details>` ancestor of the hash
  target on load, on `hashchange`, and on a TOC link click (a click on the already-current hash
  fires no `hashchange`), then scrolls the target into view explicitly (on load the browser's own
  scroll already ran before the section was opened). TOC highlighting of a *folded* section is
  not attempted: the IntersectionObserver band rarely meets a one-line element.
- Snippets inside a `test`/`docs` section keep the `unfold` flag the model set, whether the
  section is folded or rendered open; `forceSnippetsCollapsed` (ADR 0007 item 6) is removed. The
  prompt's fold rules (ADR 0014/0017) already keep test snippets folded unless the tests are the
  subject, and in a tests-only category they are the subject.

### D. Anchors (`ids.ts`)

`subsectionId(categoryIndex, kind, subsectionIndex)` keeps its index-based shape; with several
`main` subsections per category the index keeps ids distinct, and ids never drift with the
model's wording.

### E. Prompt

`explain.md` is unchanged; `## Tests` and `## Documentation` are already stated there, and are
now what the parser recognizes.

## Consequences

- A page gains real TOC children, one per section the model wrote, and its test and
  documentation sections arrive folded.
- A Mermaid diagram inside a collapsed `## Tests` section renders while hidden and, checked in
  headless Chrome, shows at its normal size once the section is opened.
- A model-written `###` inside a section renders as `h3`, the same level as a subsection heading;
  accepted.
- Stale comments and tests to update: `sections.ts`, `ids.ts`, `toc.ts`, `markdown.ts`,
  `snippets.ts`, `template.ts`, `style.css` ("Production/Test subsection"), and the subsection
  tests in `sections.test.ts`, `template.test.ts`, `toc.test.ts`, `layout.test.ts`.
- ADR 0007 item 6 is superseded. ADR 0003 stands; this ADR makes the renderer follow it.
- Out of scope: how changes are grouped into categories, and the model's freedom to name its
  main section. Only the test and docs headings are reserved.

## References

- ADR 0003 (category slicing) — introduced the conditional `## ...` sections the parser now
  follows.
- ADR 0007 item 6 (test-code snippets fold) — the per-snippet mechanism this removes.
- ADR 0014 / 0017 (fold discipline) — the `unfold` flag a section's snippets keep.
- ADR 0011 (mermaid sizing) — the diagram-in-folded-section check.
