# 16. Splitting large changes into per-concern sub-changes

> **Superseded in part by ADR 0018.** This ADR's splitter was single-axis and assumed a
> single-sided `Change` (base *or* head) and "no change to the `Change` model". ADR 0018 makes a
> `Change` carry both sides (a modification is one change) and generalizes the splitter to tile
> **both** axes from paired boundaries, so modifications split too. The phase, placement,
> coverage-by-construction guarantee, batching, and fail-soft behavior below are unchanged; the
> candidate metric, the wire shape, and `buildPartition` are as revised by ADR 0018.

## Context

A `Change` (`src/diff/change.ts`) is one contiguous run of added or removed lines
on one side of a file: a wholly-added file is a single head-side Change spanning
the file, a large deletion a single base-side Change. Phase 2 classifies a whole
Change into categories and phase 3 explains it as a unit, so a large multi-concern
change — the recurring example is a 962-line test file exercising framing, parsing
and rendering (softwaremill/jox#351) — can't be dispersed to its home categories,
and is referenced and explained whole.

ADR 0015's primary-owner ledger de-duplicates a change shared across categories but
still explains it under one owner; it can't carve a bundle into its concerns. A
deterministic (tree-sitter / brace-depth) splitter was considered and rejected: it
cuts by syntax regardless of concern, fragmenting a cohesive single-concern change
into many forced snippets.

## Decision

**Add a phase that asks an LLM where to split large changes, with coverage
guaranteed in code.**

- **Placement.** `splitLargeChanges(diff, categories, deps): ParsedDiff` runs after
  category review, before classification. It replaces each over-threshold `Change`
  with sub-`Change`s **within the same `FileDiff`** (so file `status` is inherited),
  order preserved, and returns a new `ParsedDiff`. Everything downstream (classify →
  group → explain → render) is mechanically unchanged, seeing more, smaller Changes
  keyed on their ids and ranges.

- **Candidate selection is deterministic:** a Change whose total changed line count
  exceeds `config.limits.splitThreshold` (120). Any kind qualifies — a large addition,
  deletion, or (per ADR 0018) in-place modification, counting `base` + `head` lines.
  Sub-threshold changes pass through untouched.

- **The LLM proposes split points, never ranges.** A fresh session
  (`config.models.changeSplitting` = sonnet), given the category list and, per
  candidate, its numbered diff lines, answers: does this change span more than one
  category's concern, and if so at which lines does a new segment begin? It returns
  interior split points only. Candidates are batched like classification
  (`config.limits.maxBatchSize` by count and `config.limits.maxSplitBatchDiffChars`
  by total diff text, always at least one candidate per batch) so a PR of large
  files can't build one unbounded prompt.

- **Partition by construction.** Code, not the model, builds the partition. For a
  single-sided change, points are sanitized to integers in `(start, end]`, deduped and
  sorted; segments tile `[start, p1-1], [p1, p2-1], …, [pk, end]`, each sub-Change's
  `lines` sliced to match. For a modification (ADR 0018) boundaries carry a base *and*
  head coordinate and are validated/dropped **as a pair**, tiling both axes together.
  Ids are assigned via `changeId` (ADR 0005/0018): `${path}:${side}:${s}-${e}` for a
  single-sided sub-change, `${path}:mod:${bs}-${be}:${hs}-${he}` for a modification. The
  result tiles each present side exactly regardless of the model's output. An empty,
  invalid, or unknown-`changeId` response passes the change through whole.

- **Usage is recorded.** The split session's tokens go through the run's usage
  ledger (`src/claude/usage.ts`) via the threaded `deps`, attributed to sonnet.

## Consequences

- Bundle changes are carved into per-concern pieces that classification routes
  independently, so each category references only its own pieces. The ledger (ADR
  0015) is downstream and unchanged: it receives more, smaller changes and still
  handles any sub-Change classification assigns to several categories — splitting
  just makes that rarer.

- **Behavioral shift to expect:** `splitThreshold` (120) is far below the
  explainer's `diffThreshold` (`config.limits.defaultDiffThreshold` = 400), so a
  large change previously rendered reference-only is carved into sub-changes, more of
  which fall under 400 and are therefore quoted **inline** in the explain prompt (a
  sub-change still over 400 stays reference-only). Desirable (smaller coherent
  pieces), but not "no change".

- Split boundary *placement* is nondeterministic (LLM); coverage is not — every
  line's presence is guaranteed in code. Because boundary quality isn't
  correctness-critical, sonnet is the model (judgment, cheaper than opus); a poor
  split only costs grouping quality.

- New: a `src/splitting/` module, a `split` prompt (`src/prompts/`, ADR 0006), and
  `config.limits.splitThreshold` / `config.limits.maxSplitBatchDiffChars` /
  `config.models.changeSplitting`. (ADR 0018 later revised the `Change` model — both
  sides on one change — and the splitter's wire shape and `buildPartition` with it; the
  "no change to the `Change` model" this ADR assumed no longer holds.)

## References

- ADR 0005 (identity by id) — the change id sub-Changes reuse; ids stay code-assigned
  and opaque (ADR 0018 adds the `mod:` form for a modification).
- ADR 0018 (one `Change` = one diff) — supersedes this ADR's single-axis splitter and
  single-sided `Change` assumption; the splitter now tiles both axes for any kind.
- ADR 0015 (primary-owner ledger) — the downstream stage that receives the finer
  changes; complementary, not replaced.
- ADR 0006 (externalized prompts) — the split prompt follows the `src/prompts/*.md`
  loader + `coverage.test.ts` manifest pattern.
- ADR 0002 (deterministic checkout) — the determinism preference this phase weighs
  against.
