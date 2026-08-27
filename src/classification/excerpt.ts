import type { Change } from "../diff/change.js";

/** Diff excerpts longer than this are truncated with a marker, to keep batch prompts bounded. */
export const MAX_EXCERPT_CHARS = 2000;
const TRUNCATION_MARKER = "\n… (excerpt truncated)";

/**
 * Renders a change's raw diff lines (each still carrying its `+`/`-` marker) as a single excerpt
 * string suitable for a classification prompt, truncating very large excerpts with a marker.
 */
export function buildExcerpt(change: Change): string {
  const full = change.lines.join("\n");
  if (full.length <= MAX_EXCERPT_CHARS) {
    return full;
  }
  return full.slice(0, MAX_EXCERPT_CHARS - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}
