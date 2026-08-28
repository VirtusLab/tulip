import { describe, expect, it } from "vitest";
import { config } from "../config.js";
import { batchChanges } from "./batch.js";
import type { ClassifiableChange } from "./types.js";

const MAX_BATCH_SIZE = config.limits.maxBatchSize;
const MAX_BATCH_EXCERPT_CHARS = config.limits.maxBatchExcerptChars;

function change(id: string, excerpt = "+line"): ClassifiableChange {
  return {
    id,
    path: "src/x.ts",
    status: "modified",
    side: "head",
    range: { start: 1, end: 1 },
    excerpt,
    lines: [excerpt],
  };
}

describe("batchChanges", () => {
  it("puts everything in one batch when well under both limits", () => {
    const changes = [change("c1"), change("c2"), change("c3")];
    expect(batchChanges(changes)).toEqual([changes]);
  });

  it("returns no batches for an empty input", () => {
    expect(batchChanges([])).toEqual([]);
  });

  it("splits once MAX_BATCH_SIZE changes have accumulated", () => {
    const changes = Array.from({ length: MAX_BATCH_SIZE + 5 }, (_, i) => change(`c${i}`));

    const batches = batchChanges(changes);

    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(MAX_BATCH_SIZE);
    expect(batches[1]).toHaveLength(5);
  });

  it("splits once the excerpt char budget would be exceeded", () => {
    const bigExcerpt = "x".repeat(MAX_BATCH_EXCERPT_CHARS - 10);
    const changes = [change("c1", bigExcerpt), change("c2", bigExcerpt)];

    const batches = batchChanges(changes);

    expect(batches).toHaveLength(2);
    expect(batches[0]).toEqual([changes[0]]);
    expect(batches[1]).toEqual([changes[1]]);
  });

  it("keeps a single oversized change in its own batch rather than splitting it", () => {
    const hugeExcerpt = "x".repeat(MAX_BATCH_EXCERPT_CHARS * 2);
    const changes = [change("c1", hugeExcerpt)];

    expect(batchChanges(changes)).toEqual([changes]);
  });
});
