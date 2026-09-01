import type { JsonSchema } from "../claude/schema.js";

/**
 * Raw wire types and JSON schemas for talking to the category-reviewing session (see
 * ./review.ts). Kept separate from the public domain model in ./types.ts, mirroring
 * src/explanations/wire.ts's REVIEW_SCHEMA/ReviewResponse.
 */

/** Shape the category-reviewing session replies with. */
export const CATEGORY_REVIEW_SCHEMA: JsonSchema = {
  type: "object",
  required: ["approved", "issues"],
  properties: {
    approved: { type: "boolean" },
    issues: {
      type: "array",
      items: {
        type: "object",
        required: ["description"],
        properties: { description: { type: "string" } },
      },
    },
  },
};

export interface CategoryReviewResponse {
  approved: boolean;
  issues: { description: string }[];
}
