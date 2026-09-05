# 14. Fold discipline and attention budget

## Context

ADR 0013 (signature-first explanations) asked explanations to lead with a changed
method's interface — name, parameters, return type, high-level behavior — and keep
`unfold` keyed to whether the body itself is the thing to read. A real page
(softwaremill/jox#351) showed the "lead with the signature" half landed but the
fold half didn't: 19 of 22 snippets were unfolded (1365 lines by default),
including a 962-line test file and a 164-line pure-delegation facade the prose
itself called dead, and a *Skim*-rated group out-worded both *Read-closely* groups.

Root cause: ADR 0013's two unfold bullets read as a symmetric choice ("unfold when
X, fold when Y"), so the model's default show-the-code bias won — the corollary of
"lead with the signature" ("therefore *fold* the routine body") was never stated.
Separately, `explain.md` already told the model to tune fold/length by "the
category's attention rating", but `buildExplainPrompt`/`buildReviewPrompt`
(`src/explanations/prompt.ts`) never substituted that rating into the prompt — the
model was tuning by a value it never received.

A research+critique dialogue
(`.superpowers/sdd/PLAN/fold-discipline-research.md`,
`fold-discipline-critique.md`) converged on a design; this ADR records it.

## Decision

**Fold by default; unfold only on a named trigger; enforce it at review time; wire
the attention rating into both prompts.**

- **Fold-by-default.** `explain.md` now states the default explicitly: write
  `unfold="no"` — a folded snippet still satisfies the existing coverage
  requirement (every change appears as a snippet) and stays one click away. Write
  `unfold="yes"` only when a named trigger applies.
- **Four named triggers**, replacing ADR 0013's looser "small, subtle, or hides a
  side effect": **SMALL** (~10 lines or fewer, a concrete anchor rather than "a
  few"), **SUBTLE** (edge cases, ordering, retry/error paths, concurrency),
  **HIDDEN EFFECT** (signature doesn't reveal a mutation/side effect), and — new —
  **CORE**: the primary logic a category introduces or rewrites, whose shape isn't
  reconstructable from the signature, shown even when not "subtle". CORE exists
  because "the whole thing is new" is explicitly *not* a trigger by itself (a
  large routine/wiring/mechanical-churn body folds however large), and without
  CORE that rule over-folds the one substantial, novel body a reviewer came to
  read. CORE is bounded to logic the signature can't convey, so it can't regress
  into "show everything new."
- **Never-unfold list, method-by-method and subject-aware**, not a whole-file
  label: a pure-delegation facade folds its forwarding methods, but a method that
  does real work is unfolded by the normal triggers; a test file folds when it
  verifies production code elsewhere, but when the tests are this category's own
  subject (a new or reworked suite), representative/novel cases are shown and only
  the repetitive remainder folds; generated files (checkable — a tool emits them,
  no one hand-edits) always fold.
- **Within-category scope**, not cross-category anti-duplication. Each category is
  explained in an isolated session (`explain.md`'s existing framing), so a
  cross-reference to "the other category" is a dangling pointer. The prompt
  instead asks the model to say each thing once *within this explanation*, point
  back to its own earlier snippet, and explain only this category's concern —
  not re-explain the surrounding module or the rest of the PR.
- **Attention budget, wired and absolute.** `{{attention}}` (the ADR 0010 label —
  "Read closely" / "Read through" / "Skim", via `ATTENTION_LABEL`) is now
  substituted into both `buildExplainPrompt` and `buildReviewPrompt`
  (`src/explanations/prompt.ts`), rendered as an `Attention rating: {{attention}}`
  line right after each template's `Category:` line. The budget wording is
  deliberately absolute, not comparative: no per-category session sees another
  category, so "never be longer than a higher-attention category" is
  unenforceable in-session. A SMALL/SUBTLE/CORE body stays unfolded at any
  rating — attention tunes only how much *routine* code shows.
- **Review-time enforcement.** `review.md` gains one merged
  "fold discipline & attention budget" bullet (not two, to avoid growing the
  reviewer's checklist past what it can actually attend to): flag large routine
  bodies, forwarding-facade methods, whole test files that aren't the category's
  subject, generated files, and any unfold with no named trigger; check depth
  against `{{attention}}`; explicitly don't flag a correctly-unfolded
  SMALL/SUBTLE/CORE body (protects ADR 0013's guarantee from the reviewer too).
  The earned-references bullet gains a clause so a trivial-but-required snippet's
  one-line mention isn't misread as an unexplained, coverage-only fold. A new
  "no duplication" bullet is scoped to *this* explanation only.
- **Deferred, not implemented here:** a render-time, deterministic (non-LLM)
  proportionality check — the pipeline is the only stage that sees every
  category's markdown and attention rating at once, so it's the only place a
  genuine cross-category "Skim isn't the longest section" comparison could run.
  Tracked in `TODO.md`.

## Consequences

- `src/prompts/explain.md` and `src/prompts/review.md` both require an
  `{{attention}}` value; `buildExplainPrompt`/`buildReviewPrompt` supply it from
  `input.category.attention` via `ATTENTION_LABEL` — no new fields needed on
  `ExplainCategoryInput`/`ReviewLoopInput`, since both already carry the full
  `Category`.
- Explanations should show fewer, more deliberately-chosen unfolded snippets;
  large routine bodies, dead facades, and incidental test files fold by default;
  genuinely novel core logic still shows in full regardless of size.
- No schema, markup, or rendering change — `unfold` was already per-snippet
  boolean markup; this is prompt wording plus one prompt-input substitution.

## References

- ADR 0010 (per-category attention rating) — the enum/label this ADR finally
  wires into the explain/review prompts.
- ADR 0012 (category review stage) — the review-loop shape this ADR's merged
  bullet extends.
- ADR 0013 (signature-first explanations) — the unfold triad and interface-first
  prose this ADR tightens; SMALL/SUBTLE/HIDDEN-EFFECT stay named triggers
  verbatim, so its "never fold a small/subtle body" guarantee is unchanged.
- `.superpowers/sdd/PLAN/fold-discipline-research.md` /
  `fold-discipline-critique.md` — the research+critique dialogue this ADR
  records, including the jox#351 evidence and the CORE-trigger reconciliation.
