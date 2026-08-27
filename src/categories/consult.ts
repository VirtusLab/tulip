import type { RunnerDeps } from "../claude/runner.js";
import type { JsonSchema } from "../claude/schema.js";
import { resumeSession } from "../claude/session.js";
import type { LineRange } from "../diff/change.js";
import { CATEGORY_SCHEMA, type Category } from "./types.js";

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
  /** Present when accepted; may refine the proposed name/description. */
  category?: Category;
}

const CONSULT_CATEGORY_SCHEMA: JsonSchema = {
  type: "object",
  required: ["accept"],
  properties: {
    accept: { type: "boolean" },
    category: CATEGORY_SCHEMA,
  },
};

function buildPrompt(proposedName: string, change: ConsultationChange): string {
  return `While classifying the PR's changes into the categories you created, the
classifier found a change that didn't fit any of them. It proposes adding a
new category named "${proposedName}".

The change is in ${change.path}, lines ${change.range.start}-${change.range.end}:

${change.excerpt}

Should this new category be added? Reply with accept: true if it's a good,
cohesive addition alongside the categories you already created — you may
refine its name or description. Reply with accept: false if the change should
instead fit one of the existing categories.`;
}

/**
 * Escape hatch for phase 2 (epic 5): when the classifier can't fit a change into any existing
 * category, this resumes the phase-1 session (which already knows the full category list) and
 * asks whether the classifier's proposed new category is appropriate. On acceptance, the
 * classifier should continue with the (possibly refined) category added to its list; on
 * rejection, it should be told to pick from the existing categories instead.
 */
export async function consultOnCategory(
  input: ConsultCategoryInput,
  deps: RunnerDeps = {},
): Promise<ConsultCategoryResult> {
  const { result } = await resumeSession<ConsultCategoryResult>(
    {
      sessionId: input.sessionId,
      schema: CONSULT_CATEGORY_SCHEMA,
      prompt: buildPrompt(input.proposedName, input.change),
    },
    deps,
  );
  return result;
}
