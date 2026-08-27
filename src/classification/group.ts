import type { Category } from "../categories/types.js";
import type { ClassifyChangesResult } from "./orchestrate.js";
import type { ClassifiableChange } from "./types.js";

/** One category's changes, split by code type, ready for phase 3 (epic 6) to explain. */
export interface CategoryChangeSet {
  category: Category;
  production: ClassifiableChange[];
  test: ClassifiableChange[];
}

/**
 * Groups a classification result's changes by category, in the result's presentation order.
 * A change assigned to multiple categories appears once in each. Ignored changes never appear
 * (they're not in `result.assignments` to begin with).
 */
export function groupChangesByCategory(result: ClassifyChangesResult): CategoryChangeSet[] {
  return result.categories.map((category) => {
    const production: ClassifiableChange[] = [];
    const test: ClassifiableChange[] = [];

    for (const [changeId, assignments] of result.assignments) {
      const change = result.changesById.get(changeId);
      if (!change) {
        continue;
      }
      for (const assignment of assignments) {
        if (assignment.category !== category.name) {
          continue;
        }
        (assignment.codeType === "production" ? production : test).push(change);
      }
    }

    return { category, production, test };
  });
}
