import { ClaudeOutputError } from "../claude/errors.js";
import type { RunnerDeps } from "../claude/runner.js";
import { resumeSession, runSession } from "../claude/session.js";
import { config } from "../config.js";
import { createLogger, type Logger } from "../logging/logger.js";
import { type CategoryInputFile, GENERATE_CATEGORIES_SCHEMA } from "./generate.js";
import { buildCategoryReviewAmendPrompt, buildCategoryReviewPrompt } from "./prompt.js";
import { assignCategoryIds, type Category, type CategoryProposal } from "./types.js";
import { CATEGORY_REVIEW_SCHEMA, type CategoryReviewResponse } from "./wire.js";

/** Review rounds before giving up and keeping the latest list — reuses the same cap as the
 * explanation review loop (see src/explanations/review.ts). */
const MAX_REVIEW_ROUNDS = config.limits.maxReviewRounds;

/** What the category review loop needs: the same PR title/description/file list phase 1 got
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

export interface CategoryReviewLoopDeps extends RunnerDeps {
  /** Defaults to a fresh non-verbose logger. Used only to log the round-cap warning below. */
  logger?: Logger;
}

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
 * with a fresh sonnet session (self-containment, granularity, no standalone tests/docs
 * category, sensible attention ratings — docs/adr/0003/0010). If it raises issues, resumes the
 * category-generating session for a full revised list, reassigns ids (docs/adr/0005 — ids are
 * always code-assigned, in presentation order, never authored by the model), then re-reviews
 * with another fresh session. Runs up to {@link MAX_REVIEW_ROUNDS} rounds; if issues remain
 * after the last one, keeps that latest list and logs a warning rather than looping forever.
 */
export async function reviewAndAmendCategories(
  input: CategoryReviewLoopInput,
  deps: CategoryReviewLoopDeps = {},
): Promise<CategoryReviewLoopResult> {
  const logger = deps.logger ?? createLogger();
  let categories = input.categories;
  let generateSessionId = input.generateSessionId;

  for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
    logger.debug(`category review round ${round}/${MAX_REVIEW_ROUNDS}`);
    const review = await runSession<CategoryReviewResponse>(
      {
        model: config.models.review,
        schema: CATEGORY_REVIEW_SCHEMA,
        prompt: buildCategoryReviewPrompt({
          prTitle: input.prTitle,
          prDescription: input.prDescription,
          files: input.files,
          categories,
        }),
      },
      deps,
    );

    if (review.result.approved || review.result.issues.length === 0) {
      return { categories, sessionId: generateSessionId };
    }

    if (round === MAX_REVIEW_ROUNDS) {
      logger.info(
        `warning: category split still had review issues after ${MAX_REVIEW_ROUNDS} rounds; ` +
          "keeping the latest list",
      );
      return { categories, sessionId: generateSessionId };
    }

    const amended = await resumeSession<{ categories: CategoryProposal[] }>(
      {
        sessionId: generateSessionId,
        schema: GENERATE_CATEGORIES_SCHEMA,
        prompt: buildCategoryReviewAmendPrompt(review.result.issues),
      },
      deps,
    );

    if (amended.result.categories.length === 0) {
      throw new ClaudeOutputError("claude returned an empty amended category list");
    }

    categories = assignCategoryIds(amended.result.categories);
    generateSessionId = amended.sessionId;
  }

  return { categories, sessionId: generateSessionId };
}
