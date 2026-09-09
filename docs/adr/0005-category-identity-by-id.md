# 5. Category identity by id, not by verbatim name

## Context

A live run on softwaremill/jox#351 hit a fatal phase-2 failure: `IncompleteCoverageError`,
"N changes still uncovered by any category" after all 3 coverage-repair attempts
(`config.limits.maxCoverageRepairAttempts`). Diagnosis traced it to how category identity is
represented on the wire.

Phase 1 (`src/categories/generate.ts`) names categories in free text, and sometimes produces
long, detailed names — e.g. `"Tests and docs (JsonFlowTest.java, docs/json.md, README.md,
...)"`. Phase 2's classifier (haiku, chosen for cost) is asked to reply with a `category` field
that must match one of those names, and both coverage verification (`src/classification/
coverage.ts`'s `isKnownCategoryName`) and grouping (`src/classification/group.ts`) decide
whether an assignment counts by comparing that string against the category list — via
`categoryNamesMatch` (`src/classification/category-name.ts`), trim + lowercase, otherwise exact.
Haiku reliably echoes short names back verbatim, but reliably fails to reproduce a long
parenthetical one exactly (dropped words, reordered file lists, truncation). The paraphrased
reply doesn't match any known category, so `isKnownCategoryName` treats the change as
**uncovered** — indistinguishable from a change the classifier never mentioned at all. Coverage
repair re-asks the same way and gets the same kind of paraphrase, so it never converges, and the
run hard-fails.

The underlying design flaw: category identity was **free-text prose the model must reproduce
character-for-character**, for a field never intended to be prose in the first place — the name
exists for the *human reviewer*, not as a machine key.

## Decision

**Identify categories by a short, code-assigned id; match classifier replies by id, not name.**

1. **Ids are assigned in code, never by the model.** `Category` (`src/categories/types.ts`)
   gains `id: string`. The model's phase-1 output stays name+description only (a new
   `CategoryProposal` wire shape carries exactly that). After `generateCategories` gets the
   model's ordered list, `assignCategoryIds` stamps `"c1"`, `"c2"`, ... in presentation order
   (`c1` = most important). The escape hatch (`src/classification/escape-hatch.ts`) assigns a
   newly accepted category the next fresh id via `nextCategoryId` (continues the `c<N>` sequence
   from the current max, so it stays unique even as categories are appended mid-run).
2. **The classifier is shown and replies with ids.** `formatCategoryList`
   (`src/classification/prompt.ts`) presents each category as `[<id>] <name>: <description>`;
   the output instructions tell the model to reply with the bracketed id (or the `"none"`/
   `"ignore"` sentinels), never the name.
3. **The id field is a dynamic JSON-schema enum, built per call.** `src/classification/wire.ts`
   builds the classify schema's `category` property as `enum: [...currentCategoryIds, "none",
   "ignore"]` from the category list in effect *at that call* — necessary because the escape
   hatch can add an id mid-run, so a static enum baked in once would reject ids that didn't
   exist yet. `src/claude/runner.ts` already validates every reply against its schema (including
   `enum`) and retries once, so a stray value is caught regardless of whether the model itself
   is constrained.
4. **Coverage and grouping match by id.** `isKnownCategoryName`/`categoryNamesMatch` become
   `isKnownCategoryId`/`categoryIdsMatch` (`src/classification/category-match.ts`, renamed from
   `category-name.ts`), comparing `assignment.category` against `category.id` (trim/lowercase
   still applied, defensively — ids are short codes so this rarely matters, but it costs
   nothing and keeps the two matchers symmetric). Both call sites use the same matcher, so a
   change coverage counts as covered can never fail to land under a category in grouping.
   `categoryNamesMatch` is kept, name-based, for its one remaining job: detecting whether an
   escape-hatch-accepted category is actually a duplicate of an existing one by name.
   Rendering still displays `category.name` to the reviewer — only the *match key* changed.
5. **Phase-1 prompt tweak.** `buildPrompt` (`src/categories/generate.ts`) now explicitly asks
   for short names (a few words) with no file lists, method-name qualifiers, or parenthetical
   asides — that detail belongs in the description — and restates that tests/docs ride inside
   their functional group, never as a standalone category. This is a secondary mitigation: even
   a short name is still prose, so it doesn't fix the matching problem by itself, but it reduces
   how often phase 1 produces the kind of name most likely to trigger the paraphrase in the
   first place, and reduces recurrence of the "leftover tests/docs group" pattern ADR 0003
   already tried to close off.

### Live enum-enforcement smoke check

Before committing to "dynamic enum" as anything more than a hint, ran two small live
`claude -p --model haiku --output-format json --json-schema` calls with a tiny
`{"category": {"enum": ["c1", "c2", "none"]}}` schema: a plain classification request, and one
that explicitly instructed the model to ignore the enum and reply with a category *name*
instead. Both returned `{"category":"c1"}` — the id, not the name, even under an explicit
instruction to violate the schema. Enum enforcement is **hard** here (`stop_reason: "tool_use"`
in both responses — structured output is implemented via constrained tool-call decoding, not a
post-hoc prompt hint). The dynamic enum is real reinforcement, not just documentation; id-based
matching is still the actual fix, since `runner.ts`'s local schema validation + one retry is the
backstop this all ultimately relies on regardless of how the CLI enforces it upstream.

## Consequences

- `Category` now carries `id`; every call site that constructs one (phase 1 generation, the
  escape hatch) must set it — enforced by the type system, not by convention.
- The classify schema is no longer a static export; `wire.ts` exposes a builder
  (`buildClassifyBatchSchema(categories)`) called fresh at every classify/resume/repair call
  site (`classify.ts`, `escape-hatch.ts`, `coverage.ts`) with the category list in effect at
  that point.
- A paraphrased category *name* in a reply can no longer accidentally match (or fail to match)
  anything — only the id does — closing the coverage/grouping consistency gap this ADR exists
  to fix. Regression test: a change classified against a slightly different *name* is not
  covered; the same change classified against the correct *id* is.
- **Known, separate limitation at the time — since addressed.** The classification change-unit
  was the diff hunk / whole-added-file (see ADR 0003 and `src/classification/prepare.ts`), so a
  category that sliced a single added file by method (e.g. one `JsonFlow` file into a `parse*`
  and a `render*` category) couldn't be honored — the whole file carried one set of assignments.
  ADR 0016 later added the splitter that carves an over-threshold change into per-concern
  sub-changes routed independently, and ADR 0018 generalized it to any change kind (including
  in-place modifications), giving phase 2 the finer-grained units this note said it lacked. The
  id-based matching fix here remains the backstop that keeps coverage/grouping correct for
  whatever the classifier decides on those units.

- **Change ids follow the same code-assigned, opaque principle.** Beyond category ids, a
  `Change`'s id (`src/diff/change.ts`) is also built only in code and never parsed — ADR 0016
  reuses it for split sub-changes, and ADR 0018 adds the `path:mod:bs-be:hs-he` form for an
  in-place modification.
