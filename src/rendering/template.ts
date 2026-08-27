import type { CategoryExplanation } from "../explanations/types.js";
import { escapeHtml } from "./escape.js";
import { categoryId, subsectionId } from "./ids.js";
import { renderProseMarkdown } from "./markdown.js";
import { type CategorySubsection, splitCategoryMarkdown } from "./sections.js";
import { buildToc, renderTocHtml } from "./toc.js";

/** Everything the page template needs: PR context plus the reviewed explanations, in
 * presentation order (see src/explanations/orchestrate.ts, epic 6). */
export interface PageInput {
  prTitle: string;
  prDescription: string;
  prUrl: string;
  explanations: CategoryExplanation[];
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

  const sections = input.explanations
    .map((explanation, index) =>
      renderCategorySection(explanation, index, subsectionsPerCategory[index] ?? []),
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
<div class="pr-description">${renderProseMarkdown(input.prDescription)}</div>
</header>
${sections}
</main>
<script src="assets/vendor/mermaid.min.js"></script>
<script src="assets/app.js" defer></script>
</body>
</html>
`;
}

function renderCategorySection(
  explanation: CategoryExplanation,
  index: number,
  subsections: CategorySubsection[],
): string {
  const { category } = explanation;
  const heading = `<h2>${escapeHtml(category.name)}</h2><p class="category-description">${escapeHtml(category.description)}</p>`;

  const body =
    subsections.length > 0
      ? subsections.map((subsection) => renderSubsection(subsection, index)).join("\n")
      : renderProseMarkdown(splitCategoryMarkdown(explanation.markdown).intro);

  return `<section id="${categoryId(index)}" class="category">\n${heading}\n${body}\n</section>`;
}

function renderSubsection(subsection: CategorySubsection, categoryIndex: number): string {
  return `<div id="${subsectionId(categoryIndex, subsection.kind)}" class="subsection subsection-${subsection.kind}">
<h3>${escapeHtml(subsection.heading)}</h3>
${renderProseMarkdown(subsection.markdown)}
</div>`;
}
