import { parseSnippetRefs } from "../explanations/markup.js";
import type { FileDiffData } from "./file-diffs.js";
import { findMermaidFences, renderMermaidPlaceholder } from "./mermaid.js";
import { renderWithSegments, type Segment } from "./segments.js";
import { renderSnippetBlock } from "./snippets.js";

export { renderProseMarkdown } from "./prose.js";

/** Page-wide state threaded through every `renderCategoryMarkdown` call, so all of a page's
 * mermaid diagrams and snippet blocks are numbered/resolved consistently. */
export interface MarkdownRenderContext {
  /** Every mermaid diagram's raw source, in document order — a placeholder's
   * `data-mermaid-index` is its position in this list (see ./assets/app.js). Mutated in place
   * as diagrams are encountered. */
  mermaidSources: string[];
  /** Diff data for every path referenced by a `{{snippet}}` marker anywhere on the page (see
   * ./file-diffs.ts). */
  fileDiffs: Map<string, FileDiffData>;
}

/**
 * Converts one category (sub)section's markdown to HTML: prose via {@link renderProseMarkdown},
 * ```mermaid fences into client-rendered diagram placeholders (task 7.2), and `{{snippet}}`
 * markers into side-by-side diff blocks (task 7.3, see ./snippets.ts).
 */
export function renderCategoryMarkdown(markdown: string, ctx: MarkdownRenderContext): string {
  const mermaidSegments: Segment[] = findMermaidFences(markdown).map((fence) => ({
    start: fence.start,
    end: fence.end,
    render: () => {
      const index = ctx.mermaidSources.push(fence.source) - 1;
      return renderMermaidPlaceholder(fence.source, index);
    },
  }));

  const snippetSegments: Segment[] = parseSnippetRefs(markdown).map((match) => ({
    start: match.start,
    end: match.end,
    render: () => renderSnippetBlock(match.ref, ctx.fileDiffs),
  }));

  return renderWithSegments(markdown, [...mermaidSegments, ...snippetSegments]);
}
