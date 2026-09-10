import { type CategoryChangeSet, type ChangeOwner, isPrimary } from "../classification/group.js";
import { createLogger } from "../logging/logger.js";
import type { CategoryFile } from "../rendering/file-tree.js";
import { verifySnippetCoverage } from "./coverage.js";
import { explainCategory } from "./explain.js";
import { verifyMermaidDiagrams } from "./mermaid-verify.js";
import { type ReviewLoopDeps, type ReviewLoopResult, reviewAndAmend } from "./review.js";
import type { CategoryExplanation } from "./types.js";

/** Everything phase 3 needs to explain every category. */
export interface ExplainCategoriesInput {
  prTitle: string;
  prDescription: string;
  /** Max diff size (in lines) fed verbatim per change; see src/pipeline/run.js's PipelineOptions. */
  diffThreshold: number;
  /** PR base/head revision SHAs, told to each session (see ./types.js's ExplainCategoryInput). */
  baseSha: string;
  headSha: string;
  /** In presentation order (see src/classification/group.js). */
  categorySets: CategoryChangeSet[];
  /** Each non-ignored change's primary owning category, keyed by change id (docs/adr/0015) — for
   * annotating and backlinking a category's secondary changes (see ./types.js's `changeOwners`). */
  changeOwners: ReadonlyMap<string, ChangeOwner>;
}

/** Thrown when one category's explanation generation fails; keeps the category name so a
 * top-level failure message (see src/pipeline/run.ts) can name it, and the original error as
 * `cause`. */
export class CategoryExplanationError extends Error {
  readonly categoryName: string;

  constructor(categoryName: string, cause: unknown) {
    super(`category "${categoryName}": ${causeMessage(cause)}`);
    this.name = "CategoryExplanationError";
    this.categoryName = categoryName;
    this.cause = cause;
  }
}

/** Thrown by {@link explainCategories} when one or more categories fail. Aggregates every
 * {@link CategoryExplanationError} (via `Promise.allSettled`, not `Promise.all`) so a failure in
 * one category never hides a concurrent failure in another. */
export class ExplainCategoriesError extends Error {
  readonly failures: CategoryExplanationError[];

  constructor(failures: CategoryExplanationError[], total: number) {
    super(
      `${failures.length} of ${total} categor${total === 1 ? "y" : "ies"} failed to explain: ` +
        failures.map((failure) => failure.message).join("; "),
    );
    this.name = "ExplainCategoriesError";
    this.failures = failures;
  }
}

function causeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Splits `categorySets` into ones with >= 1 change and ones with none in both production and
 * test — the latter would otherwise still get a full (opus) explain/review/render cycle for
 * nothing to say, ungrounded and wasted cost. */
function partitionEmptyCategorySets(categorySets: CategoryChangeSet[]): {
  kept: CategoryChangeSet[];
  dropped: CategoryChangeSet[];
} {
  const kept: CategoryChangeSet[] = [];
  const dropped: CategoryChangeSet[] = [];
  for (const set of categorySets) {
    (set.production.length === 0 && set.test.length === 0 ? dropped : kept).push(set);
  }
  return { kept, dropped };
}

/**
 * Phase 3 end to end: for every category, generates its explanation (task 6.2, opus), verifies
 * every change it was given is referenced by a snippet — amending if not (task 6.3), then runs
 * the clarity/conciseness/correctness review loop (task 6.4). Categories are explained
 * concurrently (`Promise.allSettled`); the shared `claude` process limiter (see
 * src/claude/concurrency.ts) caps actual parallelism at 3 regardless of category count, so this
 * doesn't need its own throttling. Throws {@link ExplainCategoriesError} if any category fails —
 * every failed category is reported, not just the first.
 */
export async function explainCategories(
  input: ExplainCategoriesInput,
  deps: ReviewLoopDeps = {},
): Promise<CategoryExplanation[]> {
  const logger = deps.logger ?? createLogger();
  const { kept, dropped } = partitionEmptyCategorySets(input.categorySets);
  if (dropped.length > 0) {
    logger.info(
      `dropping ${dropped.length} categor${dropped.length === 1 ? "y" : "ies"} with no changes: ` +
        dropped.map((set) => set.category.name).join(", "),
    );
  }

  const settled = await Promise.allSettled(kept.map((set) => explainOneCategory(input, set, deps)));

  const failures = settled
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason as CategoryExplanationError);
  if (failures.length > 0) {
    throw new ExplainCategoriesError(failures, settled.length);
  }

  return settled.map((result) => (result as PromiseFulfilledResult<CategoryExplanation>).value);
}

async function explainOneCategory(
  input: ExplainCategoriesInput,
  set: CategoryChangeSet,
  deps: ReviewLoopDeps,
): Promise<CategoryExplanation> {
  const logger = deps.logger ?? createLogger();
  // Coverage is required only for this category's primary changes (docs/adr/0015): a secondary
  // change is explained by its owner and merely backlinked here, so forcing a snippet for it
  // would re-impose the duplication the ledger removes.
  const primaryChanges = [...set.production, ...set.test].filter((change) =>
    isPrimary(input.changeOwners, change.id, set.category.id),
  );

  logger.info(`explaining category "${set.category.name}"...`);

  try {
    const generated = await explainCategory(
      {
        prTitle: input.prTitle,
        prDescription: input.prDescription,
        category: set.category,
        production: set.production,
        test: set.test,
        changeOwners: input.changeOwners,
        diffThreshold: input.diffThreshold,
        baseSha: input.baseSha,
        headSha: input.headSha,
      },
      deps,
    );

    const covered = await verifySnippetCoverage(
      generated.markdown,
      generated.sessionId,
      primaryChanges,
      deps,
    );

    // docs/adr/0015 §all-secondary: a category that owns none of its changes still runs (it's not
    // empty — partitionEmptyCategorySets kept it), but renders as mostly backlinks. It needs the
    // explain pass to emit those backlinks; a full sonnet review+amend cycle would spend the most
    // cost on the least original output, so skip review for it — the cheaper of the two options
    // the ADR leaves open. Coverage above already passed trivially (empty primary set).
    const reviewed = await reviewOrSkip(input, set, covered, primaryChanges.length === 0, deps);

    // Runs after the review-amend loop (not before) since an amend can itself change a diagram —
    // this is the FINAL markdown that reaches rendering, so it's the one that must be validated
    // (docs/adr/0008).
    const verified = await verifyMermaidDiagrams(
      reviewed.markdown,
      reviewed.explainSessionId,
      set.category.name,
      deps,
    );

    logger.info(`finished explaining category "${set.category.name}"`);
    return { category: set.category, markdown: verified.markdown, files: primaryFiles(input, set) };
  } catch (error) {
    throw new CategoryExplanationError(set.category.name, error);
  }
}

/** The files this category explains — its primary-owned changes only (docs/adr/0015), deduped by
 * path — for the category's file tree. A path is marked test iff it appears only among primary
 * test changes (a file with any primary production change is production). */
function primaryFiles(input: ExplainCategoriesInput, set: CategoryChangeSet): CategoryFile[] {
  const primary = (change: { id: string }) =>
    isPrimary(input.changeOwners, change.id, set.category.id);
  const productionPaths = new Set(set.production.filter(primary).map((change) => change.path));
  const testPaths = new Set(set.test.filter(primary).map((change) => change.path));
  const paths = [...new Set([...productionPaths, ...testPaths])].sort();
  return paths.map((path) => ({ path, isTest: !productionPaths.has(path) }));
}

/** Runs the review+amend loop, unless this is an all-secondary category (`allSecondary`: it owns
 * none of its changes) — then it keeps the explanation as-is and logs at info level (see the
 * §all-secondary note at the call site). `covered` is {@link verifySnippetCoverage}'s result. */
async function reviewOrSkip(
  input: ExplainCategoriesInput,
  set: CategoryChangeSet,
  covered: { markdown: string; sessionId: string },
  allSecondary: boolean,
  deps: ReviewLoopDeps,
): Promise<ReviewLoopResult> {
  if (allSecondary) {
    const logger = deps.logger ?? createLogger();
    logger.info(
      `category "${set.category.name}" has only secondary changes; ` +
        `skipping review, it links to their owning categories (docs/adr/0015)`,
    );
    return { markdown: covered.markdown, explainSessionId: covered.sessionId };
  }
  return reviewAndAmend(
    {
      prTitle: input.prTitle,
      prDescription: input.prDescription,
      category: set.category,
      production: set.production,
      test: set.test,
      changeOwners: input.changeOwners,
      diffThreshold: input.diffThreshold,
      baseSha: input.baseSha,
      headSha: input.headSha,
      markdown: covered.markdown,
      explainSessionId: covered.sessionId,
    },
    deps,
  );
}
