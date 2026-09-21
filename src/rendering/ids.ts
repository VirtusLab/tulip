import type { CategorySubsection, SubsectionKind } from "./sections.js";

/** DOM id for the PR's original description section (task: labeled, own TOC entry — see
 * ./template.ts and ./toc.ts). Stable and unique since there's exactly one per page. */
export const PR_DESCRIPTION_ID = "pr-description";

/** DOM id for a category's top-level section, used by both the section heading and its TOC link. */
export function categoryId(categoryIndex: number): string {
  return `category-${categoryIndex}`;
}

/** DOM id for one category's subsection. `subsectionIndex` is its position among that
 * category's subsections (see src/rendering/sections.ts): a category may have several main
 * sections, and an index keeps their ids distinct and stable while the model's headings vary. */
function subsectionId(
  categoryIndex: number,
  kind: SubsectionKind,
  subsectionIndex: number,
): string {
  return `${categoryId(categoryIndex)}-${kind}-${subsectionIndex}`;
}

/** A subsection with its DOM id attached — callers read `subsection.id` alongside
 * `kind`/`heading`/`markdown`, with no separate wrapper to unpack. */
export type SubsectionWithId = CategorySubsection & { id: string };

/** Attaches each of a category's subsections with its DOM id. The one place ids get assigned, so
 * ./toc.ts's TOC entries and ./template.ts's section markup share the same ids by construction
 * instead of each deriving them independently (see ./toc.ts's `buildToc` doc comment for why that
 * matters). */
export function withSubsectionIds(
  categoryIndex: number,
  subsections: CategorySubsection[],
): SubsectionWithId[] {
  return subsections.map((subsection, subsectionIndex) => ({
    ...subsection,
    id: subsectionId(categoryIndex, subsection.kind, subsectionIndex),
  }));
}
