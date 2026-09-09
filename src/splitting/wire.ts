import type { JsonSchema } from "../claude/schema.js";
import type { DiffSide } from "../diff/change.js";

/**
 * Raw wire types and JSON schema for the split session (see ./prompt.ts, ./orchestrate.ts). The
 * model returns, per large change, the boundary points where a new segment begins — never ranges.
 * Code builds the actual partition (see ./partition.ts), so this is pure advice: coverage is
 * guaranteed regardless of what comes back (docs/adr/0016, generalized to any change kind by
 * docs/adr/0018).
 */

/** One boundary point in a change's unified sequence (base run then head run): "start a new segment
 * before this line". `side` names which run `line` indexes (base and head line numbers are
 * different scales that can overlap, so it is mandatory); `line` is a 1-based line number on that
 * side. A cut at the head's first line peels the deletions off from the additions. */
export interface SplitBoundary {
  side: DiffSide;
  line: number;
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
              required: ["side", "line"],
              properties: {
                side: { enum: ["base", "head"] },
                line: { type: "integer" },
              },
            },
          },
        },
      },
    },
  },
};
