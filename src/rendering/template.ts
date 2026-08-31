import type { CategoryExplanation } from "../explanations/types.js";
import { renderAttentionBadge } from "./attention-badge.js";
import { escapeHtml, escapeInlineScript } from "./escape.js";
import type { FileDiffData } from "./file-diffs.js";
import { categoryId, PR_DESCRIPTION_ID, subsectionId } from "./ids.js";
import { type MarkdownRenderContext, renderCategoryMarkdown } from "./markdown.js";
import {
  type CategorySections,
  type CategorySubsection,
  splitCategoryMarkdown,
} from "./sections.js";
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

const EMPTY_SECTIONS: CategorySections = { intro: "", subsections: [] };

/** Renders the full, self-contained HTML page (assumes `assets/style.css`, `assets/app.js` and
 * `assets/vendor/{mermaid,highlight}.min.js` sit alongside `index.html` — see ./assemble.ts). */
export function renderPage(input: PageInput): string {
  // Split each category's markdown exactly once — both the TOC (which needs the subsection
  // list) and the section body (which needs the intro too) read from this same array.
  const parsedSections = input.explanations.map((explanation) =>
    splitCategoryMarkdown(explanation.markdown),
  );
  const toc = buildToc(
    input.explanations.map((explanation) => explanation.category),
    parsedSections.map((sections) => sections.subsections),
  );

  const ctx: MarkdownRenderContext = { mermaidSources: [], fileDiffs: input.fileDiffs };
  const description = renderCategoryMarkdown(input.prDescription, ctx);
  const sections = input.explanations
    .map((explanation, index) =>
      renderCategorySection(explanation, index, parsedSections[index] ?? EMPTY_SECTIONS, ctx),
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
</header>
<section id="${PR_DESCRIPTION_ID}" class="page-section">
<h2>Original PR description</h2>
<p class="section-note">Written by the PR author — not part of Tulip's analysis below.</p>
${description}
</section>
${sections}
</main>
<script type="application/json" id="tulip-mermaid-sources">${escapeInlineScript(JSON.stringify(ctx.mermaidSources))}</script>
<script type="application/json" id="tulip-file-data">${escapeInlineScript(JSON.stringify(embeddableFileData(input.fileDiffs)))}</script>
<script src="assets/vendor/mermaid.min.js"></script>
<script src="assets/vendor/highlight.min.js"></script>
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
  sections: CategorySections,
  ctx: MarkdownRenderContext,
): string {
  const { category } = explanation;
  const heading = `<h2>${escapeHtml(category.name)} ${renderAttentionBadge(category.attention)}</h2><p class="category-description">${escapeHtml(category.description)}</p>`;

  // The intro (anything before the first recognized subsection heading) must render
  // unconditionally, alongside any subsections — not only when there are no subsections.
  // Dropping it silently discarded prose/mermaid/snippet content that happened to precede a
  // "## Production code"/"## Test code" heading (a real, reviewer-reported bug: epic 6's
  // coverage check verifies every change is *referenced* somewhere in the markdown, not that
  // the renderer actually emits every part of the markdown).
  const introHtml = sections.intro.trim() ? renderCategoryMarkdown(sections.intro, ctx) : "";
  const subsectionsHtml = sections.subsections
    .map((subsection, subsectionIndex) => renderSubsection(subsection, index, subsectionIndex, ctx))
    .join("\n");
  const body = [introHtml, subsectionsHtml].filter((part) => part !== "").join("\n");

  return `<section id="${categoryId(index)}" class="category page-section">\n${heading}\n${body}\n</section>`;
}

function renderSubsection(
  subsection: CategorySubsection,
  categoryIndex: number,
  subsectionIndex: number,
  ctx: MarkdownRenderContext,
): string {
  // Test-code snippets default to folded regardless of their own unfold flag (task: keep test
  // code out of the way until the reader chooses to look) — production subsections keep
  // honoring `unfold` exactly as before. See ./sections.ts for how "test" is recognized.
  const markdownOptions = { forceSnippetsCollapsed: subsection.kind === "test" };
  return `<div id="${subsectionId(categoryIndex, subsection.kind, subsectionIndex)}" class="subsection subsection-${subsection.kind}">
<h3>${escapeHtml(subsection.heading)}</h3>
${renderCategoryMarkdown(subsection.markdown, ctx, markdownOptions)}
</div>`;
}
