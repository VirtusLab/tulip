/**
 * Compares category identifiers. Shared by coverage verification (./coverage.ts, deciding
 * whether an assignment counts as covered) and grouping (./group.ts, matching assignments back
 * to a category) so the two stay consistent — an assignment coverage treats as "covered" must
 * also be the one grouping finds. `a`/`b` are category ids (see ../categories/types.ts) or the
 * "ignore"/"none" sentinels (./types.ts) — never category names, which are free text a
 * paraphrase-prone model can't be relied on to reproduce verbatim (see docs/adr/0005). Exact
 * comparison, no normalization: ids are code-assigned "c<N>" tokens constrained by the classify
 * schema's enum (see ./wire.ts), so unlike names there's no legitimate whitespace/casing variant
 * to tolerate.
 */
export function categoryIdsMatch(a: string, b: string): boolean {
  return a === b;
}

/**
 * Compares category *names* — used only to detect whether an escape-hatch-proposed new category
 * is actually a duplicate of one already on the list (./escape-hatch.ts), not for coverage/
 * grouping identity (use {@link categoryIdsMatch} for that).
 */
export function categoryNamesMatch(a: string, b: string): boolean {
  return normalize(a) === normalize(b);
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
