import type { RunnerDeps } from "../claude/runner.js";
import { resumeSession, runSession } from "../claude/session.js";
import { config } from "../config.js";
import { createLogger, type Logger } from "../logging/logger.js";
import { verifySnippetCoverage } from "./coverage.js";
import { buildReviewAmendPrompt, buildReviewPrompt } from "./prompt.js";
import type { ExplainCategoryInput } from "./types.js";
import {
  EXPLANATION_SCHEMA,
  type ExplanationResponse,
  REVIEW_SCHEMA,
  type ReviewResponse,
} from "./wire.js";

/** Review rounds before giving up and keeping the latest version (spec: "up to 3 times"). */
const MAX_REVIEW_ROUNDS = config.limits.maxReviewRounds;

/** Same PR/category/changes context the explaining session got (see ./explain.ts), plus the
 * markdown to review and the session to resume for amendments — reused so the reviewer can be
 * given the exact same changes (task 6.4's fix: correctness/groundedness needs them). */
export interface ReviewLoopInput extends ExplainCategoryInput {
  markdown: string;
  /** Explaining session id (see ./explain.ts) — resumed to amend when the reviewer raises issues. */
  explainSessionId: string;
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
  const changes = [...input.production, ...input.test];
  let markdown = input.markdown;
  let explainSessionId = input.explainSessionId;

  for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
    logger.debug(`category "${input.category.name}": review round ${round}/${MAX_REVIEW_ROUNDS}`);
    const review = await runSession<ReviewResponse>(
      {
        model: config.models.review,
        schema: REVIEW_SCHEMA,
        prompt: buildReviewPrompt({
          prTitle: input.prTitle,
          prDescription: input.prDescription,
          category: input.category,
          production: input.production,
          test: input.test,
          diffThreshold: input.diffThreshold,
          baseSha: input.baseSha,
          headSha: input.headSha,
          markdown,
        }),
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
      changes,
      deps,
    );
    markdown = covered.markdown;
    explainSessionId = covered.sessionId;
  }

  return markdown;
}
