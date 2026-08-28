import { CATEGORY_SCHEMA, type Category, type CategoryProposal } from "../categories/types.js";
import type { JsonSchema } from "../claude/schema.js";
import { type CodeType, IGNORE_CATEGORY, NONE_CATEGORY } from "./types.js";

/**
 * Raw wire types and JSON schemas for talking to the classifier (see ./classify.ts,
 * ./escape-hatch.ts, ./coverage.ts). Kept separate from the public domain model in ./types.ts —
 * these shapes exist only to be validated against and parsed out of the classifier's replies.
 */

/** Shape the classifier is asked to reply with for a single assignment on a change. `category`
 * is constrained to an enum of the CURRENT category ids plus the sentinels — see
 * {@link buildClassifyBatchSchema}. */
function buildAssignmentSchema(categoryIds: string[]): JsonSchema {
  return {
    type: "object",
    required: ["category", "codeType"],
    properties: {
      category: { type: "string", enum: [...categoryIds, NONE_CATEGORY, IGNORE_CATEGORY] },
      codeType: { type: "string", enum: ["production", "test"] },
      /** Required (checked after schema validation) when `category` is the "none" sentinel. */
      suggestedCategory: CATEGORY_SCHEMA,
    },
  };
}

/** Shape the classifier is asked to reply with for one change. */
function buildClassificationSchema(categoryIds: string[]): JsonSchema {
  return {
    type: "object",
    required: ["changeId", "assignments"],
    properties: {
      changeId: { type: "string" },
      assignments: { type: "array", items: buildAssignmentSchema(categoryIds) },
    },
  };
}

/**
 * Builds the classify schema fresh for each call, from the CURRENT category list — necessary
 * because the escape hatch (./escape-hatch.ts) can add a category id mid-run, so a static enum
 * baked in once would reject ids that didn't exist yet at that point. `src/claude/runner.ts`
 * already validates every reply against the schema it was given (including `enum`) and retries
 * once, so a stray value here is still caught even if the CLI's own enforcement were ever soft
 * (see docs/adr/0005 for a live check confirming it's not).
 */
export function buildClassifyBatchSchema(categories: Category[]): JsonSchema {
  const categoryIds = categories.map((category) => category.id);
  return {
    type: "object",
    required: ["classifications"],
    properties: {
      classifications: { type: "array", items: buildClassificationSchema(categoryIds) },
    },
  };
}

/** One raw assignment as returned by the classifier, before "ignore"/"none" are resolved.
 * `category` is the category id the classifier chose (see ../categories/types.ts), or the
 * "ignore"/"none" sentinel. */
export interface RawAssignment {
  category: string;
  codeType: CodeType;
  suggestedCategory?: CategoryProposal;
}

/** One change's raw classification reply, before "ignore"/"none" are resolved. */
export interface RawChangeClassification {
  changeId: string;
  assignments: RawAssignment[];
}

export interface ClassifyBatchResponse {
  classifications: RawChangeClassification[];
}
