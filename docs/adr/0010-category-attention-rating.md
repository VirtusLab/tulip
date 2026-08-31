# 10. Per-category attention rating

## Context

ADR 0003 established that a category's ordering and its "how closely to read this"
verdict are attention-driven, but kept both as free prose: the model ordered groups
"most important first" and wrote a read-carefully/skim aside into the description.
The author asked for this promoted to a first-class, per-category field. A
research+critique dialogue (`.superpowers/sdd/PLAN/importance-research.md`,
`importance-critique.md`) converged on a design; this ADR records it.

## Decision

**Add `attention` — a required, model-assigned enum on `Category` and
`CategoryProposal` — and derive presentation order from it.**

- **Axis:** reviewer attention — how closely a group deserves to be read, driven by
  trickiness and cost-of-mistake. Same axis ADR 0003 already named; not risk,
  priority, or severity (those measure something else, or don't apply here).
- **Values / labels:** `"close"` → "Read closely", `"normal"` → "Read through",
  `"skim"` → "Skim". Three fully-labeled, descriptive levels — not numbers — chosen
  for repeatability across model runs (few items, one rater) over finer numeric
  gradation.
- **Schema:** `CATEGORY_SCHEMA` requires `attention` as a hard-constrained enum, like
  the classification `codeType`/`id` enums. The model rates every group it proposes.
- **Order follows the rating:** presentation order is *derived*, not authored by the
  model. `assignCategoryIds` stable-sorts proposals by attention rank
  (`close` < `normal` < `skim`) and only then numbers them `c1..cn`, so `c1` is
  always the first Read-closely group; ties keep the model's own emitted order. The
  prompt's old "order the groups, most important first" instruction is removed —
  asking for it while re-sorting around it was self-contradictory, and the model
  never needs to think about order now.
- **Default-to-middle rubric:** the prompt starts every group at "Read through" and
  promotes/demotes only with a reason, resisting the dominant failure mode
  (top-inflation) better than a symmetric anchor. No forced spread, no count cap.
- **Anti-partition invariant (reconciling with ADR 0003):** attention rates a group
  *after* it's been formed by concern; it must never become a second cutting axis
  (splitting a feature's tricky core from its wiring). The schema can't enforce
  this, so the prompt states it explicitly, adjacent to the rating instruction.
- **Escape hatch:** a category accepted mid-run
  (`src/classification/escape-hatch.ts`) always gets `attention: "normal"`,
  set explicitly and unconditionally — never taken from the consult reply. The
  consult prompt is deliberately never taught the rubric (that's a diff-level
  judgment call ADR 0003 kept off the cheap per-change path), so whatever value
  `CATEGORY_SCHEMA` forces the model to fill in there is untrustworthy.
- **Rendering:** a small label badge next to each category's name, in both the
  section heading and the floating TOC entry, with three visual weights (warm/
  strongest for Read closely, neutral for Read through, muted for Skim; theme-aware,
  never color-only). No badge on Production/Test subsections or the PR-description
  entry — attention is a property of a category, not its parts.

## Consequences

- `Category`/`CategoryProposal` gain a required field; every construction site
  (generation, escape hatch) and every test fixture must supply it.
- `ADR 0003`'s category identity/matching (ADR 0005, by `id`) is untouched —
  attention is display/order metadata, never part of matching or the cut.
- The model no longer authors an explicit order; a future change to ordering only
  needs to touch the rank table in `assignCategoryIds`, not the prompt.
- Deferred: a numeric or finer-grained scale, if real usage shows 3 levels
  clustering badly on large PRs — not built speculatively.

## References

- ADR 0003 (attention-based category slicing) — this ADR formalizes its prose
  attention signal into a field; the functional-partition decision is unchanged.
- ADR 0005 (category identity by id) — id assignment now runs after the
  attention-rank sort, but stays code-assigned and untouched in mechanism.
- `.superpowers/sdd/PLAN/importance-research.md` / `importance-critique.md` — the
  research+critique dialogue that converged on this design.
