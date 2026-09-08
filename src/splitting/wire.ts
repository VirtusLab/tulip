import type { JsonSchema } from "../claude/schema.js";

/**
 * Raw wire types and JSON schema for the split session (see ./prompt.ts, ./orchestrate.ts). The
 * model returns, per large change, the interior line numbers where a new segment begins — never
 * ranges. Code builds the actual partition (see ./partition.ts), so this is pure advice: coverage
 * is guaranteed regardless of what comes back (docs/adr/0016).
 */

/** One change's proposed split points. `splitBefore` is a list of 1-based side line numbers, each
 * the first line of a new segment; an empty list means "single coherent concern, don't split". */
export interface SplitProposal {
  changeId: string;
  splitBefore: number[];
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
        required: ["changeId", "splitBefore"],
        properties: {
          changeId: { type: "string" },
          splitBefore: { type: "array", items: { type: "integer" } },
        },
      },
    },
  },
};
