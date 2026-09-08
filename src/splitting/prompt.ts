import type { Category } from "../categories/types.js";
import type { Change, FileStatus } from "../diff/change.js";
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

/** Each diff line prefixed with its 1-based side line number, so a split point (a line number) is
 * unambiguous: line `range.start + i` carries `change.lines[i]`. */
function formatNumberedLines(change: Change): string {
  return change.lines.map((line, i) => `  ${change.range.start + i}: ${line}`).join("\n");
}

function formatCandidate({ change, status }: SplitCandidate): string {
  return `- changeId: ${change.id}
  file: ${change.path} (${status})
  side: ${change.side}, lines ${change.range.start}-${change.range.end}
  diff:
${formatNumberedLines(change)}`;
}

/** Renders the split prompt (src/prompts/split.md, docs/adr/0006): the category list plus each
 * candidate's numbered diff lines. */
export function buildSplitPrompt(input: SplitPromptInput): string {
  return renderPrompt("split", {
    categoryList: formatCategoryList(input.categories),
    changes: input.candidates.map(formatCandidate).join("\n\n"),
  });
}
