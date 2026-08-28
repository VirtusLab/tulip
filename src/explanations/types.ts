import type { Category } from "../categories/types.js";
import type { ClassifiableChange } from "../classification/types.js";

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
}
