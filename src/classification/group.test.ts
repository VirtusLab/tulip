import { describe, expect, it } from "vitest";
import { groupChangesByCategory } from "./group.js";
import type { ClassifyChangesResult } from "./orchestrate.js";
import type { ClassifiableChange } from "./types.js";

function change(id: string): ClassifiableChange {
  return {
    id,
    path: `src/${id}.ts`,
    status: "modified",
    head: { range: { start: 1, end: 1 }, lines: ["+line"] },
    excerpt: "+line",
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

    const { sets, owners } = groupChangesByCategory(result);

    expect(sets.map((g) => g.category.name)).toEqual(["B", "A"]);
    expect(sets[0]).toEqual({ category: result.categories[0], production: [c3], test: [] });
    expect(sets[1]).toEqual({ category: result.categories[1], production: [c1], test: [c2] });
    // Each change is owned by the (only) category it was assigned to.
    expect(owners).toEqual(
      new Map([
        ["c3", { ownerCategoryId: "c1", ownerTitle: "B" }],
        ["c1", { ownerCategoryId: "c2", ownerTitle: "A" }],
        ["c2", { ownerCategoryId: "c2", ownerTitle: "A" }],
      ]),
    );
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

    const { owners } = groupChangesByCategory(result);

    // The owner map has exactly one entry per non-ignored change (one primary each), and c1 —
    // assigned to both categories — is owned by the first (index 0), not the second.
    expect(owners).toEqual(
      new Map([
        ["c1", { ownerCategoryId: "c1", ownerTitle: "First" }],
        ["c2", { ownerCategoryId: "c2", ownerTitle: "Second" }],
      ]),
    );
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

    const { owners } = groupChangesByCategory(result);

    expect(owners.get("x1")).toEqual({ ownerCategoryId: "c3", ownerTitle: "Earlier" });
  });

  it("makes a change spanning three categories primary only in the first (docs/adr/0015)", () => {
    // The motivating case (jox#351): one change assigned to three categories. It's listed under
    // all three, but owned by exactly the first in array order — secondary in the two later ones.
    const c1 = change("c1");
    const result: ClassifyChangesResult = {
      categories: [
        { id: "c1", name: "First", description: "", attention: "normal" },
        { id: "c2", name: "Second", description: "", attention: "normal" },
        { id: "c3", name: "Third", description: "", attention: "normal" },
      ],
      assignments: new Map([
        [
          "c1",
          [
            { category: "c1", codeType: "production" },
            { category: "c2", codeType: "production" },
            { category: "c3", codeType: "production" },
          ],
        ],
      ]),
      ignoredChangeIds: new Set(),
      changesById: new Map([["c1", c1]]),
    };

    const { sets, owners } = groupChangesByCategory(result);

    expect(sets.map((s) => s.production)).toEqual([[c1], [c1], [c1]]);
    expect(owners).toEqual(new Map([["c1", { ownerCategoryId: "c1", ownerTitle: "First" }]]));
  });
});
