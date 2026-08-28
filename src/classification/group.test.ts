import { describe, expect, it } from "vitest";
import { groupChangesByCategory } from "./group.js";
import type { ClassifyChangesResult } from "./orchestrate.js";
import type { ClassifiableChange } from "./types.js";

function change(id: string): ClassifiableChange {
  return {
    id,
    path: `src/${id}.ts`,
    status: "modified",
    side: "head",
    range: { start: 1, end: 1 },
    excerpt: "+line",
    lines: ["+line"],
  };
}

describe("groupChangesByCategory", () => {
  it("groups changes by category, in category presentation order, split by code type", () => {
    // Category ids ("c1"/"c2") and change ids ("c1"/"c2"/"c3") happen to share the same string
    // space here — coincidental, they're unrelated fields (`category` vs. map key).
    const c1 = change("c1");
    const c2 = change("c2");
    const c3 = change("c3");
    const result: ClassifyChangesResult = {
      categories: [
        { id: "c1", name: "B", description: "second" },
        { id: "c2", name: "A", description: "first" },
      ],
      assignments: new Map([
        ["c1", [{ category: "c2", codeType: "production" }]],
        ["c2", [{ category: "c2", codeType: "test" }]],
        ["c3", [{ category: "c1", codeType: "production" }]],
      ]),
      ignoredChangeIds: new Set(),
      changesById: new Map([
        ["c1", c1],
        ["c2", c2],
        ["c3", c3],
      ]),
    };

    const grouped = groupChangesByCategory(result);

    expect(grouped.map((g) => g.category.name)).toEqual(["B", "A"]);
    expect(grouped[0]).toEqual({ category: result.categories[0], production: [c3], test: [] });
    expect(grouped[1]).toEqual({ category: result.categories[1], production: [c1], test: [c2] });
  });

  it("matches category ids case-insensitively and ignoring surrounding whitespace", () => {
    const c1 = change("c1");
    const result: ClassifyChangesResult = {
      categories: [{ id: "c1", name: "Retry logic", description: "" }],
      assignments: new Map([["c1", [{ category: " C1 ", codeType: "production" }]]]),
      ignoredChangeIds: new Set(),
      changesById: new Map([["c1", c1]]),
    };

    const grouped = groupChangesByCategory(result);

    expect(grouped[0]?.production).toEqual([c1]);
  });

  it("matches by id even when the category name is long and paraphrase-prone", () => {
    // See docs/adr/0005 / coverage.test.ts's regression test: matching moved from name to id
    // specifically because a classifier can't be trusted to echo a long name back verbatim.
    const c1 = change("c1");
    const result: ClassifyChangesResult = {
      categories: [{ id: "c1", name: "Retry logic (backoff, jitter, tests)", description: "" }],
      // The classifier replied with the id, not a paraphrase of the (long) name.
      assignments: new Map([["c1", [{ category: "c1", codeType: "production" }]]]),
      ignoredChangeIds: new Set(),
      changesById: new Map([["c1", c1]]),
    };

    const grouped = groupChangesByCategory(result);

    expect(grouped[0]?.production).toEqual([c1]);
  });

  it("lists a multi-category change under every category it was assigned to", () => {
    const c1 = change("c1");
    const result: ClassifyChangesResult = {
      categories: [
        { id: "c1", name: "A", description: "" },
        { id: "c2", name: "B", description: "" },
      ],
      assignments: new Map([
        [
          "c1",
          [
            { category: "c1", codeType: "production" },
            { category: "c2", codeType: "production" },
          ],
        ],
      ]),
      ignoredChangeIds: new Set(),
      changesById: new Map([["c1", c1]]),
    };

    const grouped = groupChangesByCategory(result);

    expect(grouped[0]?.production).toEqual([c1]);
    expect(grouped[1]?.production).toEqual([c1]);
  });
});
