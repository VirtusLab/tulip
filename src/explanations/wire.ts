import type { JsonSchema } from "../claude/schema.js";

/**
 * Raw wire types and JSON schemas for talking to the explaining and reviewing sessions (see
 * ./explain.ts, ./coverage.ts, ./review.ts). Kept separate from the public domain model in
 * ./types.ts — these shapes exist only to be validated against and parsed out of replies.
 */

/** Shape the explaining session replies with — both for the initial explanation (task 6.2) and
 * every amendment (coverage fixes, task 6.3; review fixes, task 6.4). */
export const EXPLANATION_SCHEMA: JsonSchema = {
  type: "object",
  required: ["markdown"],
  properties: {
    markdown: { type: "string" },
  },
};

export interface ExplanationResponse {
  markdown: string;
}

/** Shape the reviewing session replies with. */
export const REVIEW_SCHEMA: JsonSchema = {
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

export interface ReviewResponse {
  approved: boolean;
  issues: { description: string }[];
}

/** Shape the explaining session replies with when fixing one invalid mermaid diagram (task
 * 6.6/docs/adr/0008) — just the corrected diagram source, not the full markdown, since only one
 * fence needs to change. */
export const MERMAID_FIX_SCHEMA: JsonSchema = {
  type: "object",
  required: ["source"],
  properties: {
    source: { type: "string" },
  },
};

export interface MermaidFixResponse {
  source: string;
}
