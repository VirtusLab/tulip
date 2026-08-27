/**
 * Compares category names as the model might format them slightly differently between calls
 * (extra whitespace, different casing) while still meaning the same category. Shared by coverage
 * verification (./coverage.ts, deciding whether an assignment counts as covered) and grouping
 * (./group.ts, matching assignments back to a category) so the two stay consistent — an
 * assignment coverage treats as "covered" must also be the one grouping finds.
 */
export function categoryNamesMatch(a: string, b: string): boolean {
  return normalizeCategoryName(a) === normalizeCategoryName(b);
}

function normalizeCategoryName(name: string): string {
  return name.trim().toLowerCase();
}
