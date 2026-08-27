import type { SubsectionKind } from "./sections.js";

/** DOM id for a category's top-level section, used by both the section heading and its TOC link. */
export function categoryId(categoryIndex: number): string {
  return `category-${categoryIndex}`;
}

/** DOM id for one category's subsection. `subsectionIndex` is its position among that
 * category's subsections (see src/rendering/sections.ts) — included so two subsections of the
 * same kind (e.g. a markdown with two "## Production code" headings) still get distinct ids,
 * rather than colliding on `${categoryId}-${kind}`. */
export function subsectionId(
  categoryIndex: number,
  kind: SubsectionKind,
  subsectionIndex: number,
): string {
  return `${categoryId(categoryIndex)}-${kind}-${subsectionIndex}`;
}
