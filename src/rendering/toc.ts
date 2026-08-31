import type { Attention } from "../categories/types.js";
import { renderAttentionBadge } from "./attention-badge.js";
import { escapeHtml } from "./escape.js";
import { categoryId, PR_DESCRIPTION_ID, subsectionId } from "./ids.js";
import type { CategorySubsection } from "./sections.js";

/** One entry in the floating table-of-contents: a category, optionally with its Production/Test
 * subsection children (present only when the category's markdown actually has them). `attention`
 * is set only for category entries — the PR-description entry and subsection children have none
 * of their own, so they render without a badge (docs/adr/0010). */
export interface TocEntry {
  id: string;
  label: string;
  attention?: Attention;
  children: { id: string; label: string }[];
}

const SUBSECTION_LABEL: Record<CategorySubsection["kind"], string> = {
  production: "Production code",
  test: "Test code",
};

/** Builds the TOC structure for the page: the PR's original description first (task: it's the
 * PR author's own text, not Tulip's analysis — always present, unlike categories, so it's
 * unconditional), then one entry per category in presentation order, with child entries for
 * whichever Production/Test subsections that category's markdown has. */
export function buildToc(
  categories: { name: string; attention: Attention }[],
  subsectionsPerCategory: CategorySubsection[][],
): TocEntry[] {
  const prDescriptionEntry: TocEntry = {
    id: PR_DESCRIPTION_ID,
    label: "Original PR description",
    children: [],
  };
  const categoryEntries = categories.map((category, index) => ({
    id: categoryId(index),
    label: category.name,
    attention: category.attention,
    children: (subsectionsPerCategory[index] ?? []).map((subsection, subsectionIndex) => ({
      id: subsectionId(index, subsection.kind, subsectionIndex),
      label: SUBSECTION_LABEL[subsection.kind],
    })),
  }));
  return [prDescriptionEntry, ...categoryEntries];
}

/** Renders the TOC as a `<nav>` element with nested `<ul>`s; ./assets/app.js highlights the
 * entry matching the section currently in view. A category entry's attention badge renders
 * inline before its label, so scanning the TOC shows the PR's whole attention map at a glance
 * (docs/adr/0010); the PR-description entry and subsection children have no `attention` and get
 * no badge. */
export function renderTocHtml(entries: TocEntry[]): string {
  const items = entries
    .map((entry) => {
      const badge = entry.attention ? renderAttentionBadge(entry.attention) : "";
      const children = entry.children
        .map((child) => `<li><a href="#${child.id}">${escapeHtml(child.label)}</a></li>`)
        .join("");
      const childList = children ? `<ul class="toc-children">${children}</ul>` : "";
      return `<li><a href="#${entry.id}">${badge}${escapeHtml(entry.label)}</a>${childList}</li>`;
    })
    .join("");
  return `<nav id="toc" class="toc" aria-label="Table of contents"><ul>${items}</ul></nav>`;
}
