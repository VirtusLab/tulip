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
  };
}

describe("groupChangesByCategory", () => {
  it("groups changes by category, in category presentation order, split by code type", () => {
    const c1 = change("c1");
    const c2 = change("c2");
    const c3 = change("c3");
    const result: ClassifyChangesResult = {
      categories: [
        { name: "B", description: "second" },
        { name: "A", description: "first" },
      ],
      assignments: new Map([
        ["c1", [{ category: "A", codeType: "production" }]],
        ["c2", [{ category: "A", codeType: "test" }]],
        ["c3", [{ category: "B", codeType: "production" }]],
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

  it("lists a multi-category change under every category it was assigned to", () => {
    const c1 = change("c1");
    const result: ClassifyChangesResult = {
      categories: [
        { name: "A", description: "" },
        { name: "B", description: "" },
      ],
      assignments: new Map([
        [
          "c1",
          [
            { category: "A", codeType: "production" },
            { category: "B", codeType: "production" },
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
