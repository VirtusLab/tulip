# 15. Primary-owner ledger — explain each change once, link elsewhere

## Context

Phase 2 assigns a change to one or more categories
(`ClassifyChangesResult.assignments`), and `groupChangesByCategory`
(`src/classification/group.ts`) puts the change into every assigned category's
`CategoryChangeSet`. Phase 3 explains each category in an isolated session that is
told the other categories are explained separately (`src/prompts/explain.md`), and
coverage forces *every* change in the set to be snippet-covered
(`verifySnippetCoverage`, `src/explanations/coverage.ts`). So a change assigned to
several categories is fully re-explained — snippet **and** prose — in each.

On a real page (softwaremill/jox#351) a 962-line test file was attached in three
categories (~2886 of the rendered lines were that one file, tripled), and the shared
test-suite context, the shared `ObjectMapper`, and the overload list were each
re-narrated per category. ADR 0014's "say each thing once *within* this explanation"
can't touch it: each session is blind to the others, so it re-attaches and
re-narrates the shared change. The duplication is structural, not a wording problem.

A design → critique → review dialogue converged on this ADR; the alternative of
splitting a large added file into finer classification units (per method/test) was
considered and deferred — it disperses a genuinely multi-concern file into its home
categories but risks fragmenting a cohesive single-category file into many forced
snippets, and needs a language-aware splitter. The ledger below is the
lower-risk first move and a strict prerequisite is not: the two are independent.

## Decision

**Give each change one primary owning category; the primary explains it fully, every
other category links to it and is exempt from covering it.**

- **Primary owner = first by array position.** A change's primary is the first
  category, in `result.categories` order, that it is assigned to.
  `result.categories` is `sortByAttention(state.categories)`
  (`src/classification/orchestrate.ts`) — a stable sort over the phase-1 list plus
  appended escape-hatch categories. That array order is a deterministic total order.
  **Invariant (with a test): order by array position, never by id.** Ids are
  assigned before the sort and are not renumbered, so they are non-monotonic with
  position (ADR 0005/0012) — ordering or matching by id would silently change
  ownership. Owner computation folds into `groupChangesByCategory` (same inputs,
  same array-order walk); a change assigned to one category is trivially primary
  there.

- **Coverage relaxes to primaries.** The coverage-required set becomes the
  category's primary changes only, filtered at **both** `verifySnippetCoverage`
  call sites — the initial explain (`src/explanations/orchestrate.ts`) and the
  post-amend re-check (`src/explanations/review.ts`); relaxing only the first lets
  an amend round re-impose full coverage. Every non-ignored change has exactly one
  primary that is forced to snippet it, so it is still explained once, somewhere.

- **Secondary changes are linked, not re-explained.** A secondary category mentions
  the change in prose — a substantive one line of what it does in this category's
  context — and emits a backlink to the owning category instead of a snippet. It
  *may* still show a focused slice if it genuinely needs the code through its own
  lens (allowed, not required).

- **Backlinks are inline output markup.** The explainer emits `{{catref id="c3"}}`
  inline in its prose. This is **not** the `{{snippet}}` pipeline: snippet markup is
  own-line and block-rendered, so an inline catref carved out as a segment would
  split its sentence, and the prose renderer escapes raw HTML. Instead a text-level
  pre-substitution rewrites `{{catref id="x"}}` to a markdown link
  `[Category Title](#category-<index>)` before the markdown is parsed; the
  `#category-<index>` anchor (`src/rendering/ids.ts`) is the section's array
  position and passes the prose renderer's href safety check. **Title and index come
  from the renderer**, from a category id → {index, title} map (agent supplies only
  the id), so link text always matches the real section and can't go stale or be
  hallucinated. An unknown or malformed id is left as literal text (rendered plain),
  never a crash — mirroring `parseSnippetRefs`' leniency. The map is built where the
  page is assembled (`src/rendering/template.ts`) and consumed at markdown
  substitution (`src/rendering/markdown.ts`), via a new context field alongside the
  existing `fileDiffs`.

- **Prompt wording.** `formatChange` (`src/explanations/prompt.ts`) annotates a
  secondary change inline — "already explained under \"<owner title>\": don't
  snippet it; note briefly what it does here and link with
  `{{catref id="<owner id>"}}`". The owner map and the current category's id are
  threaded via one new field on `ExplainCategoryInput`; the value must be passed at
  each explicit call site (`explainCategory`, `buildReviewPrompt`, the review-loop
  input), though the *type* reaches review for free since its inputs extend
  `ExplainCategoryInput`. `explain.md` relaxes "every change must be a snippet" to
  non-reference-only changes and states the reference-only rule; `review.md` stops
  flagging reference-only changes as missing/under-explained. Prompts must always
  use the **attributed** `{{catref id="…"}}` form — a bare `{{catref}}` matches the
  loader's placeholder pattern and would throw (ADR 0006's `coverage.test.ts`
  manifest is otherwise untouched, since attributed output markup adds no
  placeholder).

- **All-secondary category.** A category whose every change is owned earlier still
  runs (`partitionEmptyCategorySets` drops only zero-change sets, and it has
  changes). It renders as mostly backlinks. Surfaced at info level; whether it
  should skip the review loop or take a reduced budget rather than a full
  explain+review cycle is left to the implementation to decide and note.

## Consequences

- A shared change is explained once, in its highest-attention category (the earliest
  by array position), and linked from the rest — the tripled test file and repeated
  narration collapse to a single explanation plus cross-links. Total Opus cost drops
  even though Phase 3 stays parallel (no wall-clock change).
- The classification order (ADR 0005/0010/0012) becomes load-bearing for *which*
  category explains a shared change, not only for presentation order.
- New: an inline `{{catref}}` output markup and its renderer substitution; one field
  on `ExplainCategoryInput`; a primary/secondary partition on `CategoryChangeSet`.
  No change to the snippet markup, the classifier contract, or the coverage
  algorithm itself — only the set it is applied to.
- Deferred to a later phase: capturing a one-line summary of *how* the primary
  explained each change so secondary references can be richer. That needs the
  primary's output before a secondary runs, i.e. sequential Phase 3; the identity
  backlink here needs neither, which is why Phase 3 stays parallel now.

## References

- ADR 0005 (category identity by id) — ids are code-assigned and non-monotonic with
  the final array order; this ADR orders by position, never id.
- ADR 0010 (attention rating) / ADR 0012 (category review) — where the category
  order this ADR depends on is finalized.
- ADR 0006 (externalized prompts) — the placeholder manifest the attributed
  `{{catref}}` form must not trip.
- ADR 0014 (fold discipline) — its within-category "say it once" rule, which this
  ADR extends across categories via primary ownership + backlinks.
