import { escapeHtml } from "./escape.js";
import { findFences } from "./fences.js";

/** One mermaid fenced code block found in a markdown string — backtick or tilde, three or more,
 * indented by up to three spaces — with its exact character span (including the fence markers)
 * so a renderer can splice a diagram placeholder in its place. */
export interface MermaidFenceMatch {
  source: string;
  start: number;
  end: number;
}

/** Finds every mermaid fenced code block in `markdown`, in document order: every fence (see
 * ./fences.ts) whose info string is exactly "mermaid". A fence nested inside a longer one is
 * part of that block's content, so a quoted mermaid fence is not a diagram. */
export function findMermaidFences(markdown: string): MermaidFenceMatch[] {
  return findFences(markdown)
    .filter((fence) => fence.info === "mermaid")
    .map((fence) => ({ source: fence.content, start: fence.start, end: fence.end }));
}

/**
 * Renders one mermaid diagram placeholder. `index` is this diagram's position in the page-wide
 * `window.__TULIP_MERMAID__` source list (see ./template.ts), so client-side JS (./assets/app.js)
 * can restore the original source and re-render on a theme change — mermaid replaces the
 * element's content with rendered SVG in place, so the source must be kept elsewhere.
 */
export function renderMermaidPlaceholder(source: string, index: number): string {
  return `<pre class="mermaid" data-mermaid-index="${index}">${escapeHtml(source)}</pre>`;
}
