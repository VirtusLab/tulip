import { isPrimary } from "../classification/group.js";
import type { RunnerDeps } from "../claude/runner.js";
import { resumeSession, runSession } from "../claude/session.js";
import { config } from "../config.js";
import { createLogger } from "../logging/logger.js";
import { verifySnippetCoverage } from "./coverage.js";
import { buildReviewAmendPrompt, buildReviewPrompt } from "./prompt.js";
import type { ExplainCategoryInput } from "./types.js";
import {
  EXPLANATION_SCHEMA,
  type ExplanationResponse,
  REVIEW_SCHEMA,
  type ReviewResponse,
} from "./wire.js";

/** Same PR/category/changes context the explaining session got (see ./explain.ts), plus the
 * markdown to review and the session to resume for amendments — reused so the reviewer can be
 * given the exact same changes (task 6.4's fix: correctness/groundedness needs them). */
export interface ReviewLoopInput extends ExplainCategoryInput {
  markdown: string;
  /** Explaining session id (see ./explain.ts) — resumed to amend when the reviewer raises issues. */
  explainSessionId: string;
}

export type ReviewLoopDeps = RunnerDeps;

/** Reviewed (and, if amended, coverage-reverified) markdown, plus the explaining session's
 * latest id — needed by anything that must resume that same session afterward (e.g. mermaid
 * diagram fixes on the final markdown; see ./mermaid-verify.ts). */
export interface ReviewLoopResult {
  markdown: string;
  explainSessionId: string;
}

/**
 * Task 6.4: reviews `input.markdown` once with a fresh sonnet session (clarity, conciseness,
 * correctness/groundedness). If it raises issues, resumes the explaining session to amend and
 * re-verifies snippet coverage (task 6.3) on the amendment. The amended version is kept as-is,
 * without a second review (docs/adr/0025).
 */
export async function reviewAndAmend(
  input: ReviewLoopInput,
  deps: ReviewLoopDeps = {},
): Promise<ReviewLoopResult> {
  const logger = deps.logger ?? createLogger();
  // Post-amend coverage relaxes to primaries at THIS call site too (docs/adr/0015): relaxing only
  // the initial explain would let an amend round silently re-force a snippet for a secondary change.
  const primaryChanges = [...input.production, ...input.test].filter((change) =>
    isPrimary(input.changeOwners, change.id, input.category.id),
  );
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
        changeOwners: input.changeOwners,
        diffThreshold: input.diffThreshold,
        baseSha: input.baseSha,
        headSha: input.headSha,
        markdown: input.markdown,
      }),
    },
    deps,
  );

  if (review.result.approved || review.result.issues.length === 0) {
    logger.info(`category "${input.category.name}": review approved`);
    return { markdown: input.markdown, explainSessionId: input.explainSessionId };
  }

  logger.info(
    `category "${input.category.name}": review found ${review.result.issues.length} issue(s), ` +
      "amending...",
  );
  const amended = await resumeSession<ExplanationResponse>(
    {
      sessionId: input.explainSessionId,
      schema: EXPLANATION_SCHEMA,
      prompt: buildReviewAmendPrompt(review.result.issues),
    },
    deps,
  );

  const covered = await verifySnippetCoverage(
    amended.result.markdown,
    amended.sessionId,
    primaryChanges,
    input.category.name,
    deps,
  );
  return { markdown: covered.markdown, explainSessionId: covered.sessionId };
}
