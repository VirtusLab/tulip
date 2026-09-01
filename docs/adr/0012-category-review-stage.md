# 12. Category review stage, and a stricter explanation-review conciseness check

## Context

Phase 3 (explanations) is reviewed: a fresh sonnet session critiques each
explanation and the explaining session amends, up to `config.limits.maxReviewRounds`
(`src/explanations/review.ts`). Phase 1 (category generation,
`src/categories/generate.ts`) has no equivalent — a bad split (features fused or
fragmented, a standalone tests/docs group, misjudged attention) ships uncorrected
and shapes every later phase, since phase 2 classifies against it and phase 3
explains it category by category.

Separately, the explanation reviewer's own prompt checks clarity, conciseness, and
correctness, but "conciseness" was one word with no elaboration — explanations were
observed over-explaining obvious code and belaboring boilerplate.

## Decision

**Add a phase-1 review loop, mirroring `reviewAndAmend`; strengthen the phase-3
reviewer's conciseness check.**

### Category review (new)

- `src/categories/review.ts`'s `reviewAndAmendCategories` mirrors
  `src/explanations/review.ts`'s `reviewAndAmend`: a fresh sonnet session
  (`config.models.review`) critiques the category list; on issues, the
  category-*generating* session (its id, returned by `generateCategories`) is
  resumed for a full revised list and re-reviewed with another fresh session; capped
  at `config.limits.maxReviewRounds` (reused, not a new constant) — after the cap,
  the latest list is kept and a warning logged, same shape as the explanation
  reviewer's cap handling.
- Review criteria (house style: short, plain, no jargon) — categories should:
  extract the PR's main features, each independently understandable and
  sign-off-able; sit at the right granularity (no giant catch-all, no fragmentation
  into trivia; a coherent cross-cutting concern is still a valid group — ADR 0003);
  keep tests and docs inside their functional group, never a standalone "tests" or
  "documentation" category (ADR 0003); carry sensible attention ratings — flag an
  inflated spread (everything "Read closely") or a core change under-rated as
  "Skim" (ADR 0003/0010: attention rates an already-formed group, it never
  re-splits one).
- The reviewer gets exactly what phase 1 got — PR title, description, changed-file
  list — plus the proposed categories (name, description, attention); no diffs,
  consistent with phase 1 itself.
- **Ids are (re)assigned after the list is settled.** `generateCategories` still
  stamps ids via `assignCategoryIds` on its own output (unchanged, so existing
  callers/tests are untouched); `reviewAndAmendCategories` takes that `Category[]`
  as its starting point, and only re-stamps ids (again via `assignCategoryIds`,
  stable-sort by attention rank — ADR 0005/0010) when an amendment actually
  produces a new proposal list. A round that approves outright returns the list
  unchanged, ids included.
- **Session threading.** The result's `sessionId` is the latest *category-generating*
  session id (not the reviewer's) — the same lineage `generateCategories` already
  returns. `src/pipeline/run.ts` threads this into `classifyChanges`'s
  `phase1SessionId`, so phase 2's escape hatch (`consultOnCategory`, which resumes
  that session) sees a session that already knows about any amendment.
- Wiring: `run.ts` calls `reviewAndAmendCategories` right after
  `generateCategories`; the final (possibly amended) list is what flows into
  classification. Progress logged at info (stage) / debug (round number),
  matching the explanation review loop's logging.

### Explanation reviewer conciseness (strengthened)

- `src/prompts/review.md`'s conciseness check now explicitly asks the reviewer to
  flag over-explaining the obvious, restating what the code plainly shows, dwelling
  on trivial/boilerplate parts, and any sentence that doesn't earn its place —
  padding, redundancy, belaboring a simple point. Clarity and
  correctness/groundedness checks are unchanged.

## Consequences

- Extra LLM calls in phase 1: at least one more fresh-session review per run, and
  (on issues) a generating-session resume + another review, up to the shared round
  cap — the same cost shape phase 3 already pays.
- A bad category split can now be caught and corrected before it shapes phase 2/3,
  instead of only being fixable by re-running the whole tool.
- `reviewAndAmendCategories` reuses `assignCategoryIds`/`sortByAttention`
  (`src/categories/types.ts`) rather than introducing a second id-assignment path —
  id assignment stays the one place (ADR 0005) that mints `"c<N>"` ids.

## References

- ADR 0003 (attention-based category slicing) — the functional-partition and
  no-tests/docs-category rules this review stage enforces.
- ADR 0005 (category identity by id) — ids stay code-assigned, never model-authored;
  this ADR only moves *when* assignment runs (after review, not just after
  generation).
- ADR 0010 (per-category attention rating) — the attention rubric and
  anti-partition invariant the review criteria restate.
- ADR 0006 (externalized prompt templates) — the new review/amend prompts follow
  the existing `src/prompts/*.md` + `coverage.test.ts` manifest pattern.
