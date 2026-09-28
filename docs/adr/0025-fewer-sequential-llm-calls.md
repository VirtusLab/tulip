# 25. Fewer sequential LLM calls

## Context

Real runs showed most wall time going to calls that sit one after another on
the critical path:

- The category review (ADR 0012) and the explanation review loop each ran up
  to 3 rounds (review, amend, review, ...). Logs showed the reviewer rarely
  approving an amended result: a 3-category PR spent 7m40s in category review
  and still ended with "issues after 3 rounds". The extra rounds cost time
  without converging.
- Classification batches resumed one Haiku session, so each later batch
  carried every earlier batch (and its escape-hatch turns) as context.
- Split batches ran one after another, though they are independent.

## Decision

- **One review round.** Both review loops (`src/categories/review.ts`,
  `src/explanations/review.ts`) review once and, on issues, amend once. The
  amended result is kept without a second review. `config.limits.maxReviewRounds`
  is gone.
- **Skip the category review for a single category.** There is no split to
  critique.
- **Fresh session per classification batch.** Every batch gets the full task
  prompt (`src/prompts/classify-batch.md`) and the current category list in a
  new Haiku session, so a reply depends only on its own batch. Batches still
  run in order: a category accepted via the escape hatch after batch N is in
  batch N+1's list. The escape hatch and coverage repair resume the latest
  batch's session, as before; the repair prompt already restates the rules.
- **Batch size 40.** `config.limits.maxBatchSize` rises from 20 to 40; the
  20k-char excerpt cap is unchanged and stays the effective bound for large
  changes. Fewer batches means fewer sequential calls.
- **Split batches run concurrently.** `src/splitting/orchestrate.ts` starts
  all batches at once; the global 3-process cap (`src/claude/concurrency.ts`)
  still bounds real parallelism. Results merge in batch order.

## Consequences

- Worst-case phase 1 review drops from 5 calls to 2; per-category explanation
  review from 5 to 2 (plus coverage amends).
- A reviewer's issue with the amended version now ships uncorrected, as it
  already did after the round cap.
- A fresh classification session pays the system prompt again per batch
  instead of re-reading a growing context; cost is roughly a wash for small
  PRs and lower for large ones.
- A 40-change batch asks Haiku for a longer reply; the char cap keeps the
  input bounded, and coverage repair still catches anything it skips.
