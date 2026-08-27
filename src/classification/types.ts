import { CATEGORY_SCHEMA, type Category } from "../categories/types.js";
import type { JsonSchema } from "../claude/schema.js";
import type { DiffSide, FileStatus, LineRange } from "../diff/change.js";

/** Whether a change belongs to code that ships, or to the tests that exercise it. */
export type CodeType = "production" | "test";

/** One category a change was placed into, and whether it's production or test code. */
export interface CategoryAssignment {
  category: string;
  codeType: CodeType;
}

/**
 * A {@link Change}, flattened with everything the classifier prompt needs: which file it came
 * from, that file's status, and a ready-to-send diff excerpt (see ./excerpt.ts).
 */
export interface ClassifiableChange {
  id: string;
  path: string;
  status: FileStatus;
  side: DiffSide;
  range: LineRange;
  /** Diff lines for this range, `+`/`-` markers included; truncated if very large (see ./excerpt.ts). */
  excerpt: string;
}

/** Sentinel category names the classifier may use instead of a real category (see spec). */
export const IGNORE_CATEGORY = "ignore";
export const NONE_CATEGORY = "none";

/** Shape the classifier is asked to reply with for a single assignment on a change. */
export const RAW_ASSIGNMENT_SCHEMA: JsonSchema = {
  type: "object",
  required: ["category", "codeType"],
  properties: {
    category: { type: "string" },
    codeType: { type: "string", enum: ["production", "test"] },
    /** Required (checked after schema validation) when `category` is {@link NONE_CATEGORY}. */
    suggestedCategory: CATEGORY_SCHEMA,
  },
};

/** Shape the classifier is asked to reply with for one change. */
export const RAW_CLASSIFICATION_SCHEMA: JsonSchema = {
  type: "object",
  required: ["changeId", "assignments"],
  properties: {
    changeId: { type: "string" },
    assignments: { type: "array", items: RAW_ASSIGNMENT_SCHEMA },
  },
};

/** Wraps a batch of {@link RAW_CLASSIFICATION_SCHEMA} entries — the classifier's per-call reply. */
export const CLASSIFY_BATCH_SCHEMA: JsonSchema = {
  type: "object",
  required: ["classifications"],
  properties: {
    classifications: { type: "array", items: RAW_CLASSIFICATION_SCHEMA },
  },
};

/** One raw assignment as returned by the classifier, before "ignore"/"none" are resolved. */
export interface RawAssignment {
  category: string;
  codeType: CodeType;
  suggestedCategory?: Category;
}

/** One change's raw classification reply, before "ignore"/"none" are resolved. */
export interface RawChangeClassification {
  changeId: string;
  assignments: RawAssignment[];
}

export interface ClassifyBatchResponse {
  classifications: RawChangeClassification[];
}
