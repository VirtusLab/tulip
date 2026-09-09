import type { JsonSchema } from "../claude/schema.js";

/**
 * Raw wire types and JSON schema for the split session (see ./prompt.ts, ./orchestrate.ts). The
 * model returns, per large change, the boundary points where a new segment begins — never ranges.
 * Code builds the actual partition (see ./partition.ts), so this is pure advice: coverage is
 * guaranteed per side regardless of what comes back (docs/adr/0016, generalized to two axes by
 * docs/adr/0018).
 */

/** One boundary point: "start a new segment before this line". A single-sided change (addition or
 * deletion) carries only that side; a modification must carry BOTH — the base and head line where
 * the next concern begins — so the two axes stay paired (docs/adr/0018). */
export interface SplitBoundary {
  base?: number;
  head?: number;
}

/** One change's proposed split boundaries; an empty list means "single coherent concern, don't
 * split". */
export interface SplitProposal {
  changeId: string;
  boundaries: SplitBoundary[];
}

export interface SplitResponse {
  splits: SplitProposal[];
}

export const SPLIT_SCHEMA: JsonSchema = {
  type: "object",
  required: ["splits"],
  properties: {
    splits: {
      type: "array",
      items: {
        type: "object",
        required: ["changeId", "boundaries"],
        properties: {
          changeId: { type: "string" },
          boundaries: {
            type: "array",
            items: {
              type: "object",
              properties: {
                base: { type: "integer" },
                head: { type: "integer" },
              },
            },
          },
        },
      },
    },
  },
};
