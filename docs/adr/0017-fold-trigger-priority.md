# 17. Fold-trigger priority: must-see triggers outrank the budget, SMALL yields

## Context

ADR 0014 established fold-by-default with four named unfold triggers — SMALL, SUBTLE,
HIDDEN EFFECT, CORE — and an attention budget under which a Read-through or Skim
category "stays short and folds almost everything." It also stated that a SMALL,
SUBTLE, or CORE body "stays unfolded at any rating."

Those two rules collide. Skim and Read-through categories are precisely the ones whose
changes are usually ten lines or fewer, so SMALL fires on most of them and unfolds
them — nullifying "fold almost everything" for exactly the low-attention categories the
rating exists to keep short. A Skim page ends up showing many small bodies inline, and
though the prose stays tight, the page is not.

## Decision

Rank the triggers by *why* they exist, and let that decide the conflict:

- **SUBTLE, HIDDEN EFFECT, and CORE are must-see** — the reviewer needs that specific
  code (tricky logic, a hidden side effect, the core new algorithm) no matter how much
  time they spend. They **outrank the attention budget** and stay unfolded at any
  rating, including Skim.
- **SMALL is a convenience** — its own justification is only that folding a ≤10-line
  body "trades a click for almost nothing hidden." It carries no must-see content, so it
  **yields to the budget**: a SMALL body unfolds on Read-closely (where the reviewer is
  reading anyway) but folds on Read-through or Skim, where the mass of click-saving is
  itself the length the reviewer chose to avoid.

Principle: **a must-see trigger outranks the rating; a convenience trigger yields to
it.** Wired into `src/prompts/explain.md` — the front-loaded length-priority rule (which
scopes "the rating wins" to convenience snippets, exempting the must-see triggers), the
"Trigger vs. rating" rule, and the SMALL bullet — and mirrored in `src/prompts/review.md`
(SUBTLE/HIDDEN EFFECT/CORE are never flagged when unfolded; a SMALL body shown unfolded on
a Read-through/Skim category is flagged).

## Consequences

- Skim and Read-through pages get genuinely short: small routine bodies fold, and only
  must-see code stays inline. Read-closely is unchanged — SMALL still unfolds there.
- Every correctness surface (subtle logic, hidden effects, core algorithm) stays visible
  at every rating; the budget never hides code the reviewer must read.
- Prompt-only change — no code, schema, or rendering change.

## References

- ADR 0014 (fold discipline and attention budget) — this ADR refines it: SMALL no longer
  stays unfolded "at any rating" (it yields to a tight rating), and HIDDEN EFFECT joins
  the rating-independent must-see set that ADR 0014 listed as only SMALL/SUBTLE/CORE.
- ADR 0010 (attention rating) — the Read-closely / Read-through / Skim budget this
  ordering respects.
- ADR 0013 (signature-first explanations) — the interface-first framing within which
  SMALL's convenience sits.
