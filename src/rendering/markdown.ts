import {
  type CategoryRefTarget,
  parseSnippetRefs,
  substituteCategoryRefs,
} from "../explanations/markup.js";
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
  /** Category id -> {array index, title} for every category on the page (docs/adr/0015), so an
   * inline `{{catref id="x"}}` can be rewritten to a link to that category's section. Built in
   * ./template.ts, where the ordered explanations (hence each category's index) are known. */
  categoryRefTargets: ReadonlyMap<string, CategoryRefTarget>;
}

export interface RenderCategoryMarkdownOptions {
  /** Forces every `{{snippet}}` in `markdown` to render collapsed regardless of its own
   * `unfold` flag — set by ./template.ts for a "## Test code" subsection (see ./sections.ts's
   * `SubsectionKind`), so test snippets stay out of the way by default. Defaults to `false`
   * (honor each ref's own `unfold` flag, as before). */
  forceSnippetsCollapsed?: boolean;
}

/**
 * Converts one category (sub)section's markdown to HTML: prose via {@link renderProseMarkdown},
 * ```mermaid fences into client-rendered diagram placeholders (task 7.2), and `{{snippet}}`
 * markers into side-by-side diff blocks (task 7.3, see ./snippets.ts).
 */
export function renderCategoryMarkdown(
  markdown: string,
  ctx: MarkdownRenderContext,
  options: RenderCategoryMarkdownOptions = {},
): string {
  // Inline `{{catref}}` backlinks are rewritten to markdown links first, at text level, before
  // any segment is located or the prose is parsed (docs/adr/0015) — a catref sits mid-sentence,
  // so it can't be a block segment. Own-line mermaid fences and snippet refs never overlap it,
  // so locating them on the substituted text keeps their offsets correct.
  const source = substituteCategoryRefs(markdown, ctx.categoryRefTargets);

  const mermaidSegments: Segment[] = findMermaidFences(source).map((fence) => ({
    start: fence.start,
    end: fence.end,
    render: () => {
      const index = ctx.mermaidSources.push(fence.source) - 1;
      return renderMermaidPlaceholder(fence.source, index);
    },
  }));

  const snippetSegments: Segment[] = parseSnippetRefs(source).map((match) => ({
    start: match.start,
    end: match.end,
    render: () =>
      renderSnippetBlock(match.ref, ctx.fileDiffs, options.forceSnippetsCollapsed ?? false),
  }));

  return renderWithSegments(source, [...mermaidSegments, ...snippetSegments]);
}
