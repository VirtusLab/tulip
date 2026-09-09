import { describe, expect, it } from "vitest";
import type { Category } from "../categories/types.js";
import type { Change } from "../diff/change.js";
import { buildSplitPrompt, type SplitCandidate } from "./prompt.js";

const CATEGORIES: Category[] = [
  { id: "c1", name: "Parsing", description: "Reads the wire format.", attention: "normal" },
  { id: "c2", name: "Rendering", description: "Draws the output.", attention: "skim" },
];

function candidate(): SplitCandidate {
  const change: Change = {
    id: "src/big.ts:head:10-13",
    path: "src/big.ts",
    head: {
      range: { start: 10, end: 13 },
      lines: ["+parse a", "+parse b", "+render x", "+render y"],
    },
  };
  return { change, status: "added" };
}

describe("buildSplitPrompt", () => {
  it("renders byte-identical prompt output with numbered lines and categories", async () => {
    await expect(
      buildSplitPrompt({ categories: CATEGORIES, candidates: [candidate()] }),
    ).toMatchFileSnapshot("__snapshots__/split.txt");
  });
});
