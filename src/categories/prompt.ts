import { renderPrompt } from "../prompts/loader.js";
import type { CategoryInputFile } from "./generate.js";
import type { Attention, Category, ReviewIssue } from "./types.js";

/** Reviewer-facing label for each attention level (docs/adr/0010) — kept local rather than
 * imported from src/rendering/attention-badge.ts, since categories has no reason to depend on
 * rendering. Wording must stay in sync with that module's ATTENTION_LABEL. */
const ATTENTION_LABEL: Record<Attention, string> = {
  close: "Read closely",
  normal: "Read through",
  skim: "Skim",
};

function formatFileList(files: CategoryInputFile[]): string {
  return files.map((file) => `- ${file.path} (${file.status})`).join("\n");
}

function formatCategoryList(categories: Category[]): string {
  return categories
    .map(
      (category) =>
        `- ${category.name} (${ATTENTION_LABEL[category.attention]}): ${category.description}`,
    )
    .join("\n");
}

/** What the category-reviewing session (see ./review.ts) needs: the same PR title, description,
 * and file list phase 1 got (no diffs — consistent with phase 1 itself), plus the proposed
 * category list to critique. */
export interface CategoryReviewPromptInput {
  prTitle: string;
  prDescription: string;
  files: CategoryInputFile[];
  categories: Category[];
}

/**
 * The category-reviewing session's prompt: critiques the proposed split for self-containment,
 * granularity, the no-standalone-tests/docs-category rule (ADR 0003), and sensible attention
 * ratings (ADR 0003/0010). Text lives in src/prompts/category-review.md (docs/adr/0006).
 */
export function buildCategoryReviewPrompt(input: CategoryReviewPromptInput): string {
  return renderPrompt("category-review", {
    prTitle: input.prTitle,
    prDescription: input.prDescription.trim() || "(no description provided)",
    fileList: formatFileList(input.files),
    categoryList: formatCategoryList(input.categories),
  });
}

/** Resumes the category-generating session with a reviewer's issues, asking for the full
 * revised category list (same shape as generation — see
 * src/categories/generate.ts's GENERATE_CATEGORIES_SCHEMA). Text lives in
 * src/prompts/category-review-amend.md (docs/adr/0006). */
export function buildCategoryReviewAmendPrompt(issues: ReviewIssue[]): string {
  return renderPrompt("category-review-amend", {
    issues: issues.map((issue) => `- ${issue.description}`).join("\n"),
  });
}
