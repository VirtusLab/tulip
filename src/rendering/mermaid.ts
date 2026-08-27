import { escapeHtml } from "./escape.js";

/** One ```mermaid fenced code block found in a markdown string, with its exact character span
 * (including the fence markers) so a renderer can splice a diagram placeholder in its place. */
export interface MermaidFenceMatch {
  source: string;
  start: number;
  end: number;
}

// Mirrors marked's own fenced-code-block recognition for the "mermaid" language tag: the
// fence markers must each be alone on their line.
const MERMAID_FENCE_PATTERN = /^```mermaid[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm;

/** Finds every ```mermaid fenced code block in `markdown`, in document order. */
export function findMermaidFences(markdown: string): MermaidFenceMatch[] {
  const matches: MermaidFenceMatch[] = [];
  for (const match of markdown.matchAll(MERMAID_FENCE_PATTERN)) {
    if (match.index === undefined) {
      continue;
    }
    matches.push({
      source: match[1] ?? "",
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return matches;
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
