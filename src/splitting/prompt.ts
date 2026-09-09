import type { Category } from "../categories/types.js";
import type { Change, ChangeSideContent, DiffSide, FileStatus } from "../diff/change.js";
import { renderPrompt } from "../prompts/loader.js";

/** One large change offered to the splitter, with the file status it inherits (from its
 * FileDiff — see src/diff/change.ts). */
export interface SplitCandidate {
  change: Change;
  status: FileStatus;
}

/** Everything the split prompt needs: the PR's categories and the large changes to consider. */
export interface SplitPromptInput {
  categories: Category[];
  candidates: SplitCandidate[];
}

function formatCategoryList(categories: Category[]): string {
  return categories
    .map((category) => `- [${category.id}] ${category.name}: ${category.description}`)
    .join("\n");
}

/** One side's diff lines, each prefixed with its 1-based line number on that side, so a split
 * point (a line number) is unambiguous: line `range.start + i` carries `content.lines[i]`. */
function formatNumberedLines(content: ChangeSideContent): string {
  return content.lines.map((line, i) => `  ${content.range.start + i}: ${line}`).join("\n");
}

function formatCandidate({ change, status }: SplitCandidate): string {
  const header = `- changeId: ${change.id}
  file: ${change.path} (${status})`;
  if (change.base && change.head) {
    // Modification: show both sides. (Modifications pass through the splitter whole for now; the
    // two-axis paired-boundary form arrives with the `boundaries` wire — docs/adr/0018.)
    return `${header}
  base lines ${change.base.range.start}-${change.base.range.end}:
${formatNumberedLines(change.base)}
  head lines ${change.head.range.start}-${change.head.range.end}:
${formatNumberedLines(change.head)}`;
  }
  const side: DiffSide = change.head ? "head" : "base";
  const content = (change.head ?? change.base) as ChangeSideContent;
  return `${header}
  side: ${side}, lines ${content.range.start}-${content.range.end}
  diff:
${formatNumberedLines(content)}`;
}

/** Renders the split prompt (src/prompts/split.md, docs/adr/0006): the category list plus each
 * candidate's numbered diff lines. */
export function buildSplitPrompt(input: SplitPromptInput): string {
  return renderPrompt("split", {
    categoryList: formatCategoryList(input.categories),
    changes: input.candidates.map(formatCandidate).join("\n\n"),
  });
}
