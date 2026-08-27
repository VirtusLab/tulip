import type { CategoryChangeSet } from "../classification/group.js";
import { verifySnippetCoverage } from "./coverage.js";
import { explainCategory } from "./explain.js";
import { type ReviewLoopDeps, reviewAndAmend } from "./review.js";
import type { CategoryExplanation } from "./types.js";

/** Everything phase 3 needs to explain every category. */
export interface ExplainCategoriesInput {
  prTitle: string;
  prDescription: string;
  /** Max diff size (in lines) fed verbatim per change; see src/pipeline/run.js's PipelineOptions. */
  diffThreshold: number;
  /** In presentation order (see src/classification/group.js). */
  categorySets: CategoryChangeSet[];
}

/**
 * Phase 3 end to end: for every category, generates its explanation (task 6.2, opus), verifies
 * every change it was given is referenced by a snippet — amending if not (task 6.3), then runs
 * the clarity/conciseness/correctness review loop (task 6.4). Categories are explained
 * concurrently (`Promise.all`); the shared `claude` process limiter (see
 * src/claude/concurrency.ts) caps actual parallelism at 3 regardless of category count, so this
 * doesn't need its own throttling.
 */
export async function explainCategories(
  input: ExplainCategoriesInput,
  deps: ReviewLoopDeps = {},
): Promise<CategoryExplanation[]> {
  return Promise.all(input.categorySets.map((set) => explainOneCategory(input, set, deps)));
}

async function explainOneCategory(
  input: ExplainCategoriesInput,
  set: CategoryChangeSet,
  deps: ReviewLoopDeps,
): Promise<CategoryExplanation> {
  const changes = [...set.production, ...set.test];

  const generated = await explainCategory(
    {
      prTitle: input.prTitle,
      prDescription: input.prDescription,
      category: set.category,
      production: set.production,
      test: set.test,
      diffThreshold: input.diffThreshold,
    },
    deps,
  );

  const covered = await verifySnippetCoverage(
    generated.markdown,
    generated.sessionId,
    changes,
    deps,
  );

  const markdown = await reviewAndAmend(
    {
      prTitle: input.prTitle,
      prDescription: input.prDescription,
      category: set.category,
      production: set.production,
      test: set.test,
      diffThreshold: input.diffThreshold,
      markdown: covered.markdown,
      explainSessionId: covered.sessionId,
    },
    deps,
  );

  return { category: set.category, markdown };
}
