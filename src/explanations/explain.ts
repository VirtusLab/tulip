import type { RunnerDeps } from "../claude/runner.js";
import { runSession } from "../claude/session.js";
import { config } from "../config.js";
import { buildExplainPrompt } from "./prompt.js";
import type { ExplainCategoryInput } from "./types.js";
import { EXPLANATION_SCHEMA, type ExplanationResponse } from "./wire.js";

export interface ExplainCategoryResult {
  markdown: string;
  /** Kept so task 6.3 (snippet coverage) and 6.4 (review amendments) can resume this session. */
  sessionId: string;
}

/**
 * Task 6.2: generates one category's explanation, in a fresh opus session (high capability, per
 * spec). Prompted with the PR's title/description, a task explanation, this category's
 * name/description, and its changes — full diff excerpt or a file+side+line-range reference
 * only, per a configurable per-change threshold (see ./prompt.ts).
 */
export async function explainCategory(
  input: ExplainCategoryInput,
  deps: RunnerDeps = {},
): Promise<ExplainCategoryResult> {
  const { result, sessionId } = await runSession<ExplanationResponse>(
    {
      model: config.models.explanation,
      schema: EXPLANATION_SCHEMA,
      prompt: buildExplainPrompt(input),
    },
    deps,
  );
  return { markdown: result.markdown, sessionId };
}
