import { ClaudeOutputError } from "../claude/errors.js";
import type { RunnerDeps } from "../claude/runner.js";
import type { JsonSchema } from "../claude/schema.js";
import { resumeSession } from "../claude/session.js";
import type { LineRange } from "../diff/change.js";
import { renderPrompt } from "../prompts/loader.js";
import { CATEGORY_SCHEMA, type CategoryProposal } from "./types.js";

/** The change (file + line range + a short excerpt) that prompted a new category proposal. */
export interface ConsultationChange {
  path: string;
  range: LineRange;
  /** Short diff excerpt (the added/removed lines), for context — not the whole file diff. */
  excerpt: string;
}

export interface ConsultCategoryInput {
  /** sessionId from {@link import("./generate.js").generateCategories}. */
  sessionId: string;
  /** Name the classifying (phase 2) model proposed for a new category. */
  proposedName: string;
  change: ConsultationChange;
}

export interface ConsultCategoryResult {
  accept: boolean;
  /** Present when accepted (always, enforced below); may refine the proposed name/description.
   * Name+description only — the model never assigns an id (see docs/adr/0005); the caller
   * (src/classification/escape-hatch.ts) assigns one via {@link import("./types.js").nextCategoryId}. */
  category?: CategoryProposal;
  /** Latest phase-1 session id. Resume the *next* consultation from this id, not the original
   * generateCategories one, so each consultation sees categories accepted by earlier ones. */
  sessionId: string;
}

const CONSULT_CATEGORY_SCHEMA: JsonSchema = {
  type: "object",
  required: ["accept"],
  properties: {
    accept: { type: "boolean" },
    category: CATEGORY_SCHEMA,
  },
};

/** Text lives in src/prompts/category-consult.md (docs/adr/0006). */
function buildPrompt(proposedName: string, change: ConsultationChange): string {
  return renderPrompt("category-consult", {
    proposedName,
    path: change.path,
    range: `${change.range.start}-${change.range.end}`,
    excerpt: change.excerpt,
  });
}

/** Shape actually validated against {@link CONSULT_CATEGORY_SCHEMA} — `sessionId` on
 * {@link ConsultCategoryResult} comes from the session envelope, not the model's reply. */
type ConsultCategoryResponse = Pick<ConsultCategoryResult, "accept" | "category">;

/**
 * Escape hatch for phase 2 (epic 5): when the classifier can't fit a change into any existing
 * category, this resumes the phase-1 session (which already knows the full category list) and
 * asks whether the classifier's proposed new category is appropriate. On acceptance, the
 * classifier should continue with the (possibly refined) category added to its list; on
 * rejection, it should be told to pick from the existing categories instead.
 *
 * The returned `sessionId` may differ from `input.sessionId` — resume the *next* consultation
 * (or any further phase-2 work needing the phase-1 session) from the returned id, so it's aware
 * of categories accepted by this call.
 */
export async function consultOnCategory(
  input: ConsultCategoryInput,
  deps: RunnerDeps = {},
): Promise<ConsultCategoryResult> {
  const { result, sessionId } = await resumeSession<ConsultCategoryResponse>(
    {
      sessionId: input.sessionId,
      schema: CONSULT_CATEGORY_SCHEMA,
      prompt: buildPrompt(input.proposedName, input.change),
    },
    deps,
  );

  if (result.accept && !result.category) {
    throw new ClaudeOutputError("claude accepted the new category but didn't include it");
  }

  return { ...result, sessionId };
}
