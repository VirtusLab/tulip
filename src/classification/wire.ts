import { CATEGORY_SCHEMA, type Category } from "../categories/types.js";
import type { JsonSchema } from "../claude/schema.js";
import type { CodeType } from "./types.js";

/**
 * Raw wire types and JSON schemas for talking to the classifier (see ./classify.ts,
 * ./escape-hatch.ts, ./coverage.ts). Kept separate from the public domain model in ./types.ts —
 * these shapes exist only to be validated against and parsed out of the classifier's replies.
 */

/** Shape the classifier is asked to reply with for a single assignment on a change. */
export const RAW_ASSIGNMENT_SCHEMA: JsonSchema = {
  type: "object",
  required: ["category", "codeType"],
  properties: {
    category: { type: "string" },
    codeType: { type: "string", enum: ["production", "test"] },
    /** Required (checked after schema validation) when `category` is the "none" sentinel. */
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
