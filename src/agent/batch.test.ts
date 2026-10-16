import { describe, expect, it } from "vitest";
import { batchBySize } from "./batch.js";

const size = (n: number) => n;

describe("batchBySize", () => {
  it("keeps everything in one batch when under both caps", () => {
    expect(batchBySize([1, 2, 3], 10, 100, size)).toEqual([[1, 2, 3]]);
  });

  it("splits once the count cap is reached", () => {
    expect(batchBySize([1, 1, 1, 1, 1], 2, 1000, size)).toEqual([[1, 1], [1, 1], [1]]);
  });

  it("splits once the char cap would be exceeded", () => {
    expect(batchBySize([6, 6, 6], 10, 10, size)).toEqual([[6], [6], [6]]);
  });

  it("gives a single oversized item its own batch rather than dropping it", () => {
    expect(batchBySize([50, 3], 10, 10, size)).toEqual([[50], [3]]);
  });

  it("returns no batches for an empty input", () => {
    expect(batchBySize([], 10, 10, size)).toEqual([]);
  });
});
