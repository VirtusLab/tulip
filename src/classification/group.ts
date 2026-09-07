import type { Category } from "../categories/types.js";
import { categoryIdsMatch } from "./category-match.js";
import type { ClassifyChangesResult } from "./orchestrate.js";
import type { ClassifiableChange } from "./types.js";

/** One category's changes, split by code type, ready for phase 3 (epic 6) to explain. A change
 * assigned to several categories appears in each; whether *this* category is its primary owner
 * (and so must snippet-cover it, vs. only backlink to it) is read from the owner map via
 * {@link isPrimary} — docs/adr/0015. */
export interface CategoryChangeSet {
  category: Category;
  production: ClassifiableChange[];
  test: ClassifiableChange[];
}

/** Where a change's primary explanation lives (docs/adr/0015): the id and display name of its
 * owning category, for building a backlink from a secondary category to it. */
export interface ChangeOwner {
  ownerCategoryId: string;
  ownerTitle: string;
}

/** Whether the category with `categoryId` is `changeId`'s primary owner (docs/adr/0015) — i.e. it
 * explains the change in full rather than only backlinking to it. Reads the owner map
 * {@link groupChangesByCategory} returns; a change with no owner (it matched no category) is
 * primary nowhere. This is the single source of truth for primary-vs-secondary; there is no
 * stored per-category set to keep in sync. */
export function isPrimary(
  owners: ReadonlyMap<string, ChangeOwner>,
  changeId: string,
  categoryId: string,
): boolean {
  return owners.get(changeId)?.ownerCategoryId === categoryId;
}

/** {@link groupChangesByCategory}'s result: the per-category change sets plus, keyed by change
 * id, each non-ignored change's primary owning category. */
export interface GroupedChanges {
  sets: CategoryChangeSet[];
  owners: Map<string, ChangeOwner>;
}

/**
 * Groups a classification result's changes by category, in the result's presentation order, and
 * assigns each change a single primary owning category (docs/adr/0015). A change assigned to
 * multiple categories appears once in each, but is primary in exactly one: the first, by
 * `result.categories` array position, it was assigned to — never by category id, which is
 * non-monotonic with position (docs/adr/0005/0012). Ignored changes never appear (they're not in
 * `result.assignments` to begin with). Matches assignment category ids to `result.categories`
 * with {@link categoryIdsMatch} (exact-string, not normalized) — the same matcher coverage
 * verification uses, so a change coverage counted as covered can't silently fail to land here.
 */
export function groupChangesByCategory(result: ClassifyChangesResult): GroupedChanges {
  const owners = new Map<string, ChangeOwner>();

  // `Array.prototype.map` runs the callback for each category in array order, so `owners`
  // accumulates left to right — the first category to match a change is the one that finds it
  // unowned and claims it.
  const sets = result.categories.map((category) => {
    const production: ClassifiableChange[] = [];
    const test: ClassifiableChange[] = [];

    for (const [changeId, assignments] of result.assignments) {
      const change = result.changesById.get(changeId);
      if (!change) {
        continue;
      }
      let matched = false;
      for (const assignment of assignments) {
        if (!categoryIdsMatch(assignment.category, category.id)) {
          continue;
        }
        matched = true;
        (assignment.codeType === "production" ? production : test).push(change);
      }
      // The first category (in array order) to match a change claims it as owner (docs/adr/0015).
      if (matched && !owners.has(changeId)) {
        owners.set(changeId, { ownerCategoryId: category.id, ownerTitle: category.name });
      }
    }

    return { category, production, test };
  });

  return { sets, owners };
}
