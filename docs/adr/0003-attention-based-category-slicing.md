# 3. Functional category partition, attention as order + label

## Context

Phase 1's category prompt (`src/categories/generate.ts`) grouped changes "by
functionality or type". The "or type" clause licensed exactly the wrong split: real
runs produced categories like "core streaming" / "tests" / "documentation" — a
type-based slicing that scatters a feature's tests and docs away from the code they
belong with, and that ADR 0001 never intended (it says "grouped by functionality /
type" but the phrase is about the reviewer's mental model, not a literal type-based
cut).

The explanation prompt (`src/explanations/prompt.ts`) compounded this: it split every
explanation into "## Production code" / "## Test code", omitting whichever had
nothing to say. A docs-only category (all `production`-typed, since there's no
`documentation` codeType) landed under a mislabeled "## Production code" heading, and
the input arrays fed to the model were never told to expect docs inside `production`.

This design went through a creator/critic dialogue (`.superpowers/sdd/PLAN/`,
unit2-creator.md v2, unit2-critic.md). The critic's central objection: an earlier
draft used attention/care-level as a *second cutting axis* ("group by what the change
does **and** how much care it needs"), which could split one feature into "tricky
core" + "glue" — fragments that aren't independently reviewable, that contradict
phase 2's "same piece of functionality" classification instruction, and that ask
phase 1 to judge a diff-level property (risk) it can't see from paths alone.

## Decision

**Partition by functionality/concern only; attention drives ordering and a per-group
label, never the cut.**

- Categories are a **functional/concern partition**: each one is a self-contained
  slice a reviewer can understand on its own. No "tests" or "documentation" category —
  tests and docs ride along with the code they cover, in the same group.
- A **coherent cross-cutting concern counts as a legitimate group** (e.g.
  "serialization boilerplate" spread across many files) — this is a *functional* cut
  (by role), not an attention cut, gated by the same self-containment test as any
  other group. The prompt explicitly closes the one residual loophole: this never
  means a tests-or-docs group.
- **Attention only orders the groups (most important first) and shows up in each
  group's description** ("core logic, read carefully" vs. "routine, skim"). The
  prompt explicitly forbids cutting one feature into "the hard part" and "the wiring".
- **Explanation coverage** is delivered via a one-line coverage strip (`Coverage —
  Tests: added · Docs: none`) plus conditional `## ...` sections, instead of two
  mandatory headings. The main section is named for what it covers, not hardcoded
  "production", so a docs-only category isn't mislabeled. The `production` input array
  (carrying doc changes too) is relabeled "Code and doc changes in this group", with an
  explicit mapping line telling the model where doc content in that array goes. The
  review prompt gets the same relabels plus a checklist item enforcing the strip's
  honesty.
- **No third `codeType`.** `CodeType` stays `"production" | "test"`; a `documentation`
  type would recreate the "docs are separate" bug one level down and force the cheap
  classifier (haiku) to make a fuzzy call on a currently-bright line. The classifier
  prompt gains one clarifying line: documentation files, comments, and doc-strings
  count as `"production"`.
- Phase 2's `buildInitialClassifyPrompt` ("same piece of functionality") is unchanged
  and stays correct, since every category is now a coherent functional/concern slice —
  a second reason to prefer the functional partition over an attention-sliced one,
  which would have forced a classifier rewrite.

## Consequences

- Prompt-string-only change to `buildPrompt` (categories/generate.ts),
  `buildExplainPrompt`/`buildReviewPrompt` (explanations/prompt.ts), and
  `OUTPUT_INSTRUCTIONS` (classification/prompt.ts). No schema or type changes.
- A docs-only category now explains correctly under "## Documentation" instead of a
  mislabeled "## Production code".
- The reviewer still gets attention-routing (order + read-carefully/skim label)
  without categories fragmenting a single feature across sessions.
- Deferred, not part of this change: feeding phase 1 per-file churn (`+added/-removed`
  counts) or full diffs to sharpen attention *ordering* — churn is a size/ordering
  signal only, not a care signal, and needs `CategoryInputFile` extended plus
  diff-stats plumbing. Tracked in TODO.md.
