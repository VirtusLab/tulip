# 13. Signature-first explanations

## Context

Explanations (`src/prompts/explain.md`) previously split snippets into a flat
important/supporting binary: important changes were `unfold="yes"` (shown
expanded), supporting ones `unfold="no"` (folded). In practice this defaulted to
showing full method bodies for anything deemed important, even when a method's
whole story is its signature and high-level behavior — the body itself being
noise for "what does this do". A code-summarization study found that feeding a
model just the function signature produced ~9% *more* high-quality summaries than
feeding the full code, and reviewers themselves work this way: locate core logic,
skim wiring, open the body only when the diff isn't self-explanatory.

The author asked for explanations to favor conveying a method via its signature/
interface, a call-sequence diagram, a high-level algorithm, or pseudocode, with
the full real body always referenced but foldable/expandable, rather than
defaulting to full implementation blocks. A research+critique dialogue
(`.superpowers/sdd/PLAN/signature-first-research.md`,
`signature-first-critique.md`) converged on a design; this ADR records it.

## Decision

**Lead with the interface in prose; keep one snippet per change; key `unfold` to
whether the changed body is the thing the reviewer needs to read.**

- **Interface in prose, not a snippet.** For a changed method, `explain.md` now
  asks for prose stating its name, parameters, return type, and what it promises,
  plus what its body does at a high level — a sentence, a numbered list, a
  before/after call-sequence diagram, or short pseudocode. No separate
  signature-only snippet was introduced: it was considered and rejected (2N
  snippet inflation, no clean range for multi-line signatures, and it fights
  `explain-markup-instructions.md`'s "lines … exactly as given below", which stays
  unchanged). One snippet per change still carries the real code.
- **Unfold keyed to a checkable fact, not a self-graded vibe.** The prior "mark
  important unfold=yes" is replaced: `unfold="yes"` when the changed body is
  small, its logic is subtle (edge cases, ordering, error/retry paths,
  concurrency), or the signature hides a side effect — don't fold the code the
  reviewer came for. `unfold="no"` when prose/diagram/pseudocode already conveys
  the change — a large body whose essence is signature + behavior, or the body
  didn't change at all (rename, type change, move, call-site rewiring). The
  coverage requirement (every change appears as a snippet reference) is
  unchanged; a folded snippet still satisfies it.
- **Attention (ADR 0003/0010) only tunes the threshold, never overrides.** A
  Read-closely category shows more real code unfolded, a Skim category folds
  more — but a subtle body change stays unfolded regardless of rating. No
  per-category blanket fold.
- **Pseudocode stays paired with a reference, folded is acceptable.**
  `explain-markup-instructions.md` gains a bullet, after the "never paste code"
  line, permitting inline prose/steps/pseudocode and requiring that any
  pseudocode sketch of changed logic reference the real body alongside it (folded
  is fine — one click away). The anti-drift risk this accepts is caught by
  review, not by forcing every sketch's body open.
- **`review.md` gains two matching checks.** The correctness bullet is
  strengthened: where the explanation summarizes a method or sketches pseudocode,
  the reviewer checks that summary against the referenced real code and flags
  drift. A new earned-reference bullet requires every snippet reference to carry
  prose saying what it is and why it's there, flagging snippets that exist only
  to satisfy coverage and folded snippets never actually explained — closing the
  gap where a terse folded dump could pass the conciseness check unchallenged.
  The conciseness/minimalism bullet from ADR 0012 is unchanged.

No markup or coverage-mechanism change: `unfold` was already per-snippet, and a
folded snippet already counted toward coverage. This is prompt wording only.

## Consequences

- Explanations should read closer to how reviewers already work — interface and
  intent up front, full code one click away when the reviewer needs to verify or
  the change itself is in the body.
- The reviewer session (phase-3 review loop, ADR 0012) now also polices drift
  between a prose/pseudocode summary and the real code, and unexplained/
  coverage-only snippets — both previously unenforced.
- No schema, type, or rendering changes; `src/rendering/*` and
  `src/explanations/markup.ts` are untouched.

## References

- ADR 0003 (attention-based category slicing) — attention stays "order + label,
  never the cut"; this ADR keeps unfold off that axis too.
- ADR 0006 (externalized prompt templates) — `explain.md`,
  `explain-markup-instructions.md`, and `review.md` stay `src/prompts/*.md`
  prose, no TS logic change.
- ADR 0010 (per-category attention rating) — the rating this ADR's threshold
  tuning reuses, without letting it override the body-changed rule.
- ADR 0012 (category review stage; explanation-reviewer conciseness) — the
  correctness/earned-reference checks added here sit alongside, not in tension
  with, the conciseness bullet ADR 0012 strengthened.
- `.superpowers/sdd/PLAN/signature-first-research.md` /
  `signature-first-critique.md` — the research+critique dialogue this ADR
  records, including the grounding citation (ACM TOSEM 2024 signature-only
  summarization study) and the risk/guard table.
