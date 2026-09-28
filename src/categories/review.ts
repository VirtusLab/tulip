import { ClaudeOutputError } from "../claude/errors.js";
import type { RunnerDeps } from "../claude/runner.js";
import { resumeSession, runSession } from "../claude/session.js";
import { config } from "../config.js";
import { createLogger } from "../logging/logger.js";
import { type CategoryInputFile, GENERATE_CATEGORIES_SCHEMA } from "./generate.js";
import { buildCategoryReviewAmendPrompt, buildCategoryReviewPrompt } from "./prompt.js";
import { assignCategoryIds, type Category, type CategoryProposal } from "./types.js";
import { CATEGORY_REVIEW_SCHEMA, type CategoryReviewResponse } from "./wire.js";

/** What the category review needs: the same PR title/description/file list phase 1 got
 * (see src/categories/generate.ts's GenerateCategoriesInput), the categories it proposed, and
 * the generating session's id to resume for amendments. */
export interface CategoryReviewLoopInput {
  prTitle: string;
  prDescription: string;
  files: CategoryInputFile[];
  categories: Category[];
  /** Category-generating session id (see ./generate.ts's GenerateCategoriesResult) — resumed
   * to amend when the reviewer raises issues. */
  generateSessionId: string;
}

export type CategoryReviewLoopDeps = RunnerDeps;

/** Reviewed (and, if amended, re-id-assigned) category list, plus the category-generating
 * session's latest id — NOT the reviewer's. Phase 2's escape hatch
 * (src/classification/escape-hatch.ts's consultOnCategory) resumes this session, so it must
 * reflect any amendment for consultation to see the up-to-date list. */
export interface CategoryReviewLoopResult {
  categories: Category[];
  sessionId: string;
}

/**
 * Mirrors src/explanations/review.ts's reviewAndAmend for phase 1: reviews `input.categories`
 * once with a fresh sonnet session (self-containment, granularity, no standalone tests/docs
 * category, sensible attention ratings — docs/adr/0003/0010). If it raises issues, resumes the
 * category-generating session for a full revised list and reassigns ids (docs/adr/0005 — ids are
 * always code-assigned, in presentation order, never authored by the model). The amended list is
 * taken as-is, without a second review (docs/adr/0025). A single-category list is returned
 * unreviewed: there is no split to critique.
 */
export async function reviewAndAmendCategories(
  input: CategoryReviewLoopInput,
  deps: CategoryReviewLoopDeps = {},
): Promise<CategoryReviewLoopResult> {
  const logger = deps.logger ?? createLogger();

  if (input.categories.length === 1) {
    logger.info("category review skipped: a single category has no split to review");
    return { categories: input.categories, sessionId: input.generateSessionId };
  }

  const review = await runSession<CategoryReviewResponse>(
    {
      model: config.models.review,
      schema: CATEGORY_REVIEW_SCHEMA,
      prompt: buildCategoryReviewPrompt({
        prTitle: input.prTitle,
        prDescription: input.prDescription,
        files: input.files,
        categories: input.categories,
      }),
    },
    deps,
  );

  if (review.result.approved || review.result.issues.length === 0) {
    logger.info("category review: approved");
    return { categories: input.categories, sessionId: input.generateSessionId };
  }

  logger.info(`category review: ${review.result.issues.length} issue(s), amending...`);
  const amended = await resumeSession<{ categories: CategoryProposal[] }>(
    {
      sessionId: input.generateSessionId,
      schema: GENERATE_CATEGORIES_SCHEMA,
      prompt: buildCategoryReviewAmendPrompt(review.result.issues),
    },
    deps,
  );

  if (amended.result.categories.length === 0) {
    throw new ClaudeOutputError("claude returned an empty amended category list");
  }

  return { categories: assignCategoryIds(amended.result.categories), sessionId: amended.sessionId };
}
