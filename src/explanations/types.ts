import type { Category } from "../categories/types.js";
import type { ChangeOwner } from "../classification/group.js";
import type { ClassifiableChange } from "../classification/types.js";
import type { CategoryFile } from "../rendering/file-tree.js";

/**
 * Public domain model for phase 3 (category explanations). Wire types and JSON schemas for
 * talking to the explaining/reviewing sessions live separately, in ./wire.ts.
 */

/** What the explaining session (task 6.2) needs to write one category's explanation. */
export interface ExplainCategoryInput {
  prTitle: string;
  prDescription: string;
  category: Category;
  /** This category's production-code changes (see src/classification/group.js). */
  production: ClassifiableChange[];
  /** This category's test-code changes. */
  test: ClassifiableChange[];
  /** Every non-ignored change's primary owning category, keyed by change id (docs/adr/0015) — the
   * page-wide map from grouping (src/classification/group.js). Snippet coverage is required only
   * for changes this category owns (`isPrimary` against `category.id`); its remaining changes are
   * secondary — their owner explains them, this one annotates and backlinks them with
   * `{{catref id="<owner id>"}}`. */
  changeOwners: ReadonlyMap<string, ChangeOwner>;
  /** Changes whose diff excerpt spans more lines than this are given as file+side+line-range
   * references only, not verbatim (see src/pipeline/run.js's PipelineOptions). */
  diffThreshold: number;
  /** PR base revision's commit SHA — told to the session so it can `git diff`/`git show` against
   * it (see src/github/checkout.js; both SHAs are fetched into the session's checkout). */
  baseSha: string;
  /** PR head revision's commit SHA — the checkout's working tree is this revision. */
  headSha: string;
}

/** One issue a review pass raised against an explanation (task 6.4). */
export interface ReviewIssue {
  description: string;
}

/** What the reviewing session (task 6.4) needs: the same PR/category/changes context the
 * explaining session got, plus the markdown to review — so "grounded in the changes" (spec) is
 * actually checkable, not just the explanation's internal consistency. */
export interface ReviewPromptInput extends ExplainCategoryInput {
  markdown: string;
}

/** Final, reviewed and coverage-verified result for one category. */
export interface CategoryExplanation {
  category: Category;
  markdown: string;
  /** The files this category explains (its primary-owned changes — docs/adr/0015), deduped by
   * path, for the file tree rendered at the top of the category (see src/rendering/file-tree.js).
   * Optional so fixtures that don't exercise the tree can omit it; defaults to no tree. */
  files?: CategoryFile[];
}
