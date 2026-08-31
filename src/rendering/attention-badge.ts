import type { Attention } from "../categories/types.js";
import { escapeHtml } from "./escape.js";

/** Reviewer-facing label for each attention level (docs/adr/0010) — the word is the instruction,
 * shown as a small badge next to a category's name. */
export const ATTENTION_LABEL: Record<Attention, string> = {
  close: "Read closely",
  normal: "Read through",
  skim: "Skim",
};

/** Renders the small per-category attention badge shown next to a category's name in both the
 * section heading (./template.ts) and the floating TOC entry (./toc.ts) — never on a
 * Production/Test subsection, which has no attention of its own. The label always comes from
 * {@link ATTENTION_LABEL}, a fixed enum-keyed map, never free text, so there's no injection
 * surface to escape against — `escapeHtml` here is defense-in-depth, not a real requirement.
 * The `attention-{level}` class picks up the three visual weights in ./assets/style.css. */
export function renderAttentionBadge(attention: Attention): string {
  return `<span class="attention-badge attention-${attention}">${escapeHtml(ATTENTION_LABEL[attention])}</span>`;
}
