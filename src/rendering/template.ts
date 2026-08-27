import type { CategoryExplanation } from "../explanations/types.js";
import { escapeHtml, escapeInlineScript } from "./escape.js";
import type { FileDiffData } from "./file-diffs.js";
import { categoryId, subsectionId } from "./ids.js";
import { type MarkdownRenderContext, renderCategoryMarkdown } from "./markdown.js";
import { type CategorySubsection, splitCategoryMarkdown } from "./sections.js";
import { buildToc, renderTocHtml } from "./toc.js";

/** Everything the page template needs: PR context, the reviewed explanations in presentation
 * order (see src/explanations/orchestrate.ts, epic 6), and diff data for every file referenced
 * by a `{{snippet}}` marker anywhere in them (see ./file-diffs.ts). */
export interface PageInput {
  prTitle: string;
  prDescription: string;
  prUrl: string;
  explanations: CategoryExplanation[];
  fileDiffs: Map<string, FileDiffData>;
}

/** Renders the full, self-contained HTML page (assumes `assets/style.css`, `assets/app.js` and
 * `assets/vendor/mermaid.min.js` sit alongside `index.html` — see ./assemble.ts). */
export function renderPage(input: PageInput): string {
  const subsectionsPerCategory = input.explanations.map(
    (explanation) => splitCategoryMarkdown(explanation.markdown).subsections,
  );
  const toc = buildToc(
    input.explanations.map((explanation) => explanation.category),
    subsectionsPerCategory,
  );

  const ctx: MarkdownRenderContext = { mermaidSources: [], fileDiffs: input.fileDiffs };
  const description = renderCategoryMarkdown(input.prDescription, ctx);
  const sections = input.explanations
    .map((explanation, index) =>
      renderCategorySection(explanation, index, subsectionsPerCategory[index] ?? [], ctx),
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.prTitle)} — Tulip</title>
<link rel="stylesheet" href="assets/style.css">
</head>
<body>
<button id="theme-toggle" type="button" aria-label="Toggle light/dark theme">◐</button>
${renderTocHtml(toc)}
<main>
<header id="pr-header">
<h1>${escapeHtml(input.prTitle)}</h1>
<p class="pr-link"><a href="${escapeHtml(input.prUrl)}">${escapeHtml(input.prUrl)}</a></p>
<div class="pr-description">${description}</div>
</header>
${sections}
</main>
<script type="application/json" id="tulip-mermaid-sources">${escapeInlineScript(JSON.stringify(ctx.mermaidSources))}</script>
<script type="application/json" id="tulip-file-data">${escapeInlineScript(JSON.stringify(embeddableFileData(input.fileDiffs)))}</script>
<script src="assets/vendor/mermaid.min.js"></script>
<script src="assets/app.js" defer></script>
</body>
</html>
`;
}

/** Rows for every path under the embed-size cap, keyed by path — lets ./assets/app.js reveal
 * more context around a snippet without another server round-trip. Paths over the cap are
 * omitted entirely (see ./file-diffs.ts); their snippet blocks render without expand buttons. */
function embeddableFileData(
  fileDiffs: Map<string, FileDiffData>,
): Record<string, FileDiffData["rows"]> {
  const data: Record<string, FileDiffData["rows"]> = {};
  for (const [path, diff] of fileDiffs) {
    if (diff.embeddable) {
      data[path] = diff.rows;
    }
  }
  return data;
}

function renderCategorySection(
  explanation: CategoryExplanation,
  index: number,
  subsections: CategorySubsection[],
  ctx: MarkdownRenderContext,
): string {
  const { category } = explanation;
  const heading = `<h2>${escapeHtml(category.name)}</h2><p class="category-description">${escapeHtml(category.description)}</p>`;

  const body =
    subsections.length > 0
      ? subsections.map((subsection) => renderSubsection(subsection, index, ctx)).join("\n")
      : renderCategoryMarkdown(splitCategoryMarkdown(explanation.markdown).intro, ctx);

  return `<section id="${categoryId(index)}" class="category">\n${heading}\n${body}\n</section>`;
}

function renderSubsection(
  subsection: CategorySubsection,
  categoryIndex: number,
  ctx: MarkdownRenderContext,
): string {
  return `<div id="${subsectionId(categoryIndex, subsection.kind)}" class="subsection subsection-${subsection.kind}">
<h3>${escapeHtml(subsection.heading)}</h3>
${renderCategoryMarkdown(subsection.markdown, ctx)}
</div>`;
}
