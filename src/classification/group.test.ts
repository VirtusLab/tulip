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
        { id: "c1", name: "B", description: "second", attention: "normal" },
        { id: "c2", name: "A", description: "first", attention: "normal" },
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

    const { sets } = groupChangesByCategory(result);

    expect(sets.map((g) => g.category.name)).toEqual(["B", "A"]);
    expect(sets[0]).toEqual({
      category: result.categories[0],
      production: [c3],
      test: [],
      primaryChangeIds: new Set(["c3"]),
    });
    expect(sets[1]).toEqual({
      category: result.categories[1],
      production: [c1],
      test: [c2],
      primaryChangeIds: new Set(["c1", "c2"]),
    });
  });

  it("matches category ids exactly — a case/whitespace variant does not match", () => {
    // Ids are code-assigned "c<N>" tokens constrained by the classify schema's enum, so this
    // variant can't actually come from the classifier — but the matcher is exact, not
    // normalized, so it (correctly) doesn't land in the group.
    const c1 = change("c1");
    const result: ClassifyChangesResult = {
      categories: [{ id: "c1", name: "Retry logic", description: "", attention: "normal" }],
      assignments: new Map([["c1", [{ category: " C1 ", codeType: "production" }]]]),
      ignoredChangeIds: new Set(),
      changesById: new Map([["c1", c1]]),
    };

    const { sets } = groupChangesByCategory(result);

    expect(sets[0]?.production).toEqual([]);
  });

  it("matches by id even when the category name is long and paraphrase-prone", () => {
    // See docs/adr/0005 / coverage.test.ts's regression test: matching moved from name to id
    // specifically because a classifier can't be trusted to echo a long name back verbatim.
    const c1 = change("c1");
    const result: ClassifyChangesResult = {
      categories: [
        {
          id: "c1",
          name: "Retry logic (backoff, jitter, tests)",
          description: "",
          attention: "normal",
        },
      ],
      // The classifier replied with the id, not a paraphrase of the (long) name.
      assignments: new Map([["c1", [{ category: "c1", codeType: "production" }]]]),
      ignoredChangeIds: new Set(),
      changesById: new Map([["c1", c1]]),
    };

    const { sets } = groupChangesByCategory(result);

    expect(sets[0]?.production).toEqual([c1]);
  });

  it("lists a multi-category change under every category it was assigned to", () => {
    const c1 = change("c1");
    const result: ClassifyChangesResult = {
      categories: [
        { id: "c1", name: "A", description: "", attention: "normal" },
        { id: "c2", name: "B", description: "", attention: "normal" },
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

    const { sets } = groupChangesByCategory(result);

    expect(sets[0]?.production).toEqual([c1]);
    expect(sets[1]?.production).toEqual([c1]);
  });

  it("gives a single-category change its one primary — that category", () => {
    const c1 = change("c1");
    const result: ClassifyChangesResult = {
      categories: [{ id: "c1", name: "A", description: "", attention: "normal" }],
      assignments: new Map([["c1", [{ category: "c1", codeType: "production" }]]]),
      ignoredChangeIds: new Set(),
      changesById: new Map([["c1", c1]]),
    };

    const { sets, owners } = groupChangesByCategory(result);

    expect(sets[0]?.primaryChangeIds).toEqual(new Set(["c1"]));
    expect(owners.get("c1")).toEqual({ ownerCategoryId: "c1", ownerTitle: "A" });
  });

  it("gives every non-ignored change exactly one primary across all sets", () => {
    // c1 assigned to both categories; c2 to the second only. Every change must be primary once.
    const c1 = change("c1");
    const c2 = change("c2");
    const result: ClassifyChangesResult = {
      categories: [
        { id: "c1", name: "First", description: "", attention: "normal" },
        { id: "c2", name: "Second", description: "", attention: "normal" },
      ],
      assignments: new Map([
        [
          "c1",
          [
            { category: "c1", codeType: "production" },
            { category: "c2", codeType: "production" },
          ],
        ],
        ["c2", [{ category: "c2", codeType: "production" }]],
      ]),
      ignoredChangeIds: new Set(),
      changesById: new Map([
        ["c1", c1],
        ["c2", c2],
      ]),
    };

    const { sets, owners } = groupChangesByCategory(result);

    const primaryCounts = new Map<string, number>();
    for (const set of sets) {
      for (const id of set.primaryChangeIds) {
        primaryCounts.set(id, (primaryCounts.get(id) ?? 0) + 1);
      }
    }
    expect(primaryCounts).toEqual(
      new Map([
        ["c1", 1],
        ["c2", 1],
      ]),
    );
    // c1's primary is the first category (index 0), not the second.
    expect(sets[0]?.primaryChangeIds).toEqual(new Set(["c1"]));
    expect(sets[1]?.primaryChangeIds).toEqual(new Set(["c2"]));
    expect(owners.get("c1")?.ownerCategoryId).toBe("c1");
  });

  it("owns a change at its earliest array position, not its lowest category id", () => {
    // The position-0 category has the higher id "c3"; the position-1 category has id "c1". A
    // change assigned to both must be primary at position 0 (array order), proving ownership
    // follows array position, never id ordering (docs/adr/0015).
    const c1 = change("x1");
    const result: ClassifyChangesResult = {
      categories: [
        { id: "c3", name: "Earlier", description: "", attention: "close" },
        { id: "c1", name: "Later", description: "", attention: "skim" },
      ],
      assignments: new Map([
        [
          "x1",
          [
            { category: "c1", codeType: "production" },
            { category: "c3", codeType: "production" },
          ],
        ],
      ]),
      ignoredChangeIds: new Set(),
      changesById: new Map([["x1", c1]]),
    };

    const { sets, owners } = groupChangesByCategory(result);

    expect(sets[0]?.primaryChangeIds).toEqual(new Set(["x1"]));
    expect(sets[1]?.primaryChangeIds).toEqual(new Set());
    expect(owners.get("x1")).toEqual({ ownerCategoryId: "c3", ownerTitle: "Earlier" });
  });
});
