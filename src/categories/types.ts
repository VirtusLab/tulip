import type { JsonSchema } from "../claude/schema.js";

/** One group of cohesive, self-contained changes, as presented to the reviewer. */
export interface Category {
  name: string;
  description: string;
}

/** Shared by every schema below that embeds a category. */
export const CATEGORY_SCHEMA: JsonSchema = {
  type: "object",
  required: ["name", "description"],
  properties: {
    name: { type: "string" },
    description: { type: "string" },
  },
};
