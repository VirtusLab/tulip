import { findMermaidFences, renderMermaidPlaceholder } from "./mermaid.js";
import { renderWithSegments } from "./segments.js";

export { renderProseMarkdown } from "./prose.js";

/**
 * Converts one category (sub)section's markdown to HTML, additionally turning ```mermaid
 * fences into client-rendered diagram placeholders (task 7.2). Each diagram's raw source is
 * appended to `mermaidSources` (shared across the whole page, in document order) and the
 * placeholder records its index into that list — see ./mermaid.ts and ./assets/app.js.
 */
export function renderCategoryMarkdown(markdown: string, mermaidSources: string[]): string {
  const segments = findMermaidFences(markdown).map((fence) => ({
    start: fence.start,
    end: fence.end,
    render: () => {
      const index = mermaidSources.push(fence.source) - 1;
      return renderMermaidPlaceholder(fence.source, index);
    },
  }));
  return renderWithSegments(markdown, segments);
}
