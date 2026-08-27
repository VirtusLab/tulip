import type { Category } from "../categories/types.js";
import type { ClassifiableChange } from "../classification/types.js";
import type { RunnerDeps } from "../claude/runner.js";
import { resumeSession, runSession } from "../claude/session.js";
import { createLogger, type Logger } from "../logging/logger.js";
import { verifySnippetCoverage } from "./coverage.js";
import { buildReviewAmendPrompt, buildReviewPrompt } from "./prompt.js";
import {
  EXPLANATION_SCHEMA,
  type ExplanationResponse,
  REVIEW_SCHEMA,
  type ReviewResponse,
} from "./wire.js";

/** Review rounds before giving up and keeping the latest version (spec: "up to 3 times"). */
export const MAX_REVIEW_ROUNDS = 3;

export interface ReviewLoopInput {
  prTitle: string;
  prDescription: string;
  category: Category;
  markdown: string;
  /** Explaining session id (see ./explain.ts) — resumed to amend when the reviewer raises issues. */
  explainSessionId: string;
  /** Every change fed to the explaining session — re-checked (task 6.3) after each amendment. */
  changes: ClassifiableChange[];
}

export interface ReviewLoopDeps extends RunnerDeps {
  /** Defaults to a fresh non-verbose logger. Used only to log the round-cap warning below. */
  logger?: Logger;
}

/**
 * Task 6.4: reviews `input.markdown` with a fresh sonnet session (clarity, conciseness,
 * correctness/groundedness). If it raises issues, resumes the explaining session to amend, re-
 * verifies snippet coverage (task 6.3) on the amendment, then re-reviews with another fresh
 * session. Runs up to {@link MAX_REVIEW_ROUNDS} review rounds; if issues remain after the last
 * one, keeps that latest version and logs a warning rather than looping forever.
 */
export async function reviewAndAmend(
  input: ReviewLoopInput,
  deps: ReviewLoopDeps = {},
): Promise<string> {
  const logger = deps.logger ?? createLogger();
  let markdown = input.markdown;
  let explainSessionId = input.explainSessionId;

  for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
    const review = await runSession<ReviewResponse>(
      {
        model: "sonnet",
        schema: REVIEW_SCHEMA,
        prompt: buildReviewPrompt(input.prTitle, input.prDescription, input.category, markdown),
      },
      deps,
    );

    if (review.result.approved || review.result.issues.length === 0) {
      return markdown;
    }

    if (round === MAX_REVIEW_ROUNDS) {
      logger.info(
        `warning: category "${input.category.name}" still had review issues after ` +
          `${MAX_REVIEW_ROUNDS} rounds; keeping the latest version`,
      );
      return markdown;
    }

    const amended = await resumeSession<ExplanationResponse>(
      {
        sessionId: explainSessionId,
        schema: EXPLANATION_SCHEMA,
        prompt: buildReviewAmendPrompt(review.result.issues),
      },
      deps,
    );

    const covered = await verifySnippetCoverage(
      amended.result.markdown,
      amended.sessionId,
      input.changes,
      deps,
    );
    markdown = covered.markdown;
    explainSessionId = covered.sessionId;
  }

  return markdown;
}
