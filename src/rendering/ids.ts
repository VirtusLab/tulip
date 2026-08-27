import type { SubsectionKind } from "./sections.js";

/** DOM id for a category's top-level section, used by both the section heading and its TOC link. */
export function categoryId(categoryIndex: number): string {
  return `category-${categoryIndex}`;
}

/** DOM id for one category's Production/Test subsection. */
export function subsectionId(categoryIndex: number, kind: SubsectionKind): string {
  return `${categoryId(categoryIndex)}-${kind}`;
}
