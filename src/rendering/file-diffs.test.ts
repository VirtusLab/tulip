import { describe, expect, it, vi } from "vitest";
import { loadFileDiffs } from "./file-diffs.js";

function stubCheckout(files: Record<string, { base?: string; head?: string }>) {
  return {
    getFileAtBase: vi.fn(async (path: string) => files[path]?.base),
    getFileAtHead: vi.fn(async (path: string) => files[path]?.head),
  };
}

describe("loadFileDiffs", () => {
  it("loads and diffs each requested path, deduplicated", async () => {
    const checkout = stubCheckout({ "a.ts": { base: "x\n", head: "y\n" } });
    const result = await loadFileDiffs(["a.ts", "a.ts"], checkout);

    expect(checkout.getFileAtBase).toHaveBeenCalledTimes(1);
    expect(result.get("a.ts")?.embeddable).toBe(true);
    expect(result.get("a.ts")?.rows).toEqual([
      {
        baseLine: 1,
        baseText: "x",
        baseType: "remove",
        headLine: 1,
        headText: "y",
        headType: "add",
      },
    ]);
  });

  it("omits a path present in neither revision", async () => {
    const checkout = stubCheckout({});
    const result = await loadFileDiffs(["missing.ts"], checkout);
    expect(result.has("missing.ts")).toBe(false);
  });

  it("treats a file missing on one side as empty content there (added/removed file)", async () => {
    const checkout = stubCheckout({ "new.ts": { head: "line\n" } });
    const result = await loadFileDiffs(["new.ts"], checkout);
    expect(result.get("new.ts")?.rows).toEqual([
      {
        baseLine: null,
        baseText: null,
        baseType: null,
        headLine: 1,
        headText: "line",
        headType: "add",
      },
    ]);
  });

  it("marks a file over the 200KB per-side cap as not embeddable", async () => {
    const big = "x\n".repeat(120_000); // > 200KB
    const checkout = stubCheckout({ "big.ts": { base: big, head: big } });
    const result = await loadFileDiffs(["big.ts"], checkout);
    expect(result.get("big.ts")?.embeddable).toBe(false);
  });

  it("keeps a file under the cap embeddable", async () => {
    const checkout = stubCheckout({ "small.ts": { base: "a\n", head: "a\n" } });
    const result = await loadFileDiffs(["small.ts"], checkout);
    expect(result.get("small.ts")?.embeddable).toBe(true);
  });
});
