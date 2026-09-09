import type { Category } from "../categories/types.js";
import { renderPrompt } from "../prompts/loader.js";
import { type ClassifiableChange, changeLocationRanges } from "./types.js";

function formatCategoryList(categories: Category[]): string {
  return categories
    .map((category) => `- [${category.id}] ${category.name}: ${category.description}`)
    .join("\n");
}

function formatChange(change: ClassifiableChange): string {
  return `- id: ${change.id}
  file: ${change.path} (${change.status})
  lines: ${changeLocationRanges(change)}
  diff:
  ${change.excerpt.split("\n").join("\n  ")}`;
}

function formatChanges(changes: ClassifiableChange[]): string {
  return changes.map(formatChange).join("\n\n");
}

/** Text lives in src/prompts/classify-special-categories.md (docs/adr/0006). */
const SPECIAL_CATEGORIES_EXPLANATION = renderPrompt("classify-special-categories", {});

/** Text lives in src/prompts/classify-output-instructions.md (docs/adr/0006). */
const OUTPUT_INSTRUCTIONS = renderPrompt("classify-output-instructions", {});

/** First classification call: explains the categories and the task, then lists the first batch. */
export function buildInitialClassifyPrompt(
  categories: Category[],
  batch: ClassifiableChange[],
): string {
  return renderPrompt("classify-initial", {
    categoryList: formatCategoryList(categories),
    specialCategories: SPECIAL_CATEGORIES_EXPLANATION,
    outputInstructions: OUTPUT_INSTRUCTIONS,
    changes: formatChanges(batch),
  });
}

/**
 * A later batch, within the same classification session. Restates the current category list
 * (rather than relying on the model to recall it) so that a category accepted via the escape
 * hatch after an earlier batch (see ./escape-hatch.ts) is explicitly available for this one.
 */
export function buildBatchClassifyPrompt(
  categories: Category[],
  batch: ClassifiableChange[],
): string {
  return renderPrompt("classify-next-batch", {
    categoryList: formatCategoryList(categories),
    changes: formatChanges(batch),
  });
}

/** One change's escape-hatch outcome, for {@link buildEscapeHatchResumePrompt}. */
export interface EscapeHatchOutcome {
  change: ClassifiableChange;
  accepted: boolean;
  category?: Category;
}

/** Verdict text lives in src/prompts/classify-escape-hatch-outcome-{accepted,rejected}.md
 * (docs/adr/0006) — which one applies is a TS-level conditional (docs/adr/0006's "conditional
 * assembly" case), so it's picked and rendered here rather than in the parent template. */
function formatEscapeHatchOutcome(outcome: EscapeHatchOutcome): string {
  const verdict = outcome.accepted
    ? renderPrompt("classify-escape-hatch-outcome-accepted", {
        // `?? "undefined"` mirrors the old template literal's `${outcome.category?.name}`,
        // which stringified to the literal text "undefined" if category were ever missing —
        // shouldn't happen (see EscapeHatchOutcome's category doc comment) but kept byte-exact.
        categoryName: outcome.category?.name ?? "undefined",
        categoryId: outcome.category?.id ?? "undefined",
      })
    : renderPrompt("classify-escape-hatch-outcome-rejected", {});
  return `${formatChange(outcome.change)}
  outcome: ${verdict}`;
}

/**
 * Resumes the classifier after one or more "none" proposals were resolved (see
 * ./escape-hatch.ts): reiterates the (possibly extended) category list, tells the classifier
 * what happened to each proposal, and asks it to reclassify just those changes.
 */
export function buildEscapeHatchResumePrompt(
  categories: Category[],
  outcomes: EscapeHatchOutcome[],
): string {
  return renderPrompt("classify-escape-hatch", {
    categoryList: formatCategoryList(categories),
    outcomes: outcomes.map(formatEscapeHatchOutcome).join("\n\n"),
  });
}

/**
 * Resumes the classifier to cover changes it didn't classify at all (see ./coverage.ts):
 * reiterates the category list, rules and instructions (a later batch/round may have moved on),
 * then re-lists just the uncovered changes.
 */
export function buildCoverageRepairPrompt(
  categories: Category[],
  missing: ClassifiableChange[],
): string {
  return renderPrompt("classify-coverage-repair", {
    categoryList: formatCategoryList(categories),
    specialCategories: SPECIAL_CATEGORIES_EXPLANATION,
    outputInstructions: OUTPUT_INSTRUCTIONS,
    changes: formatChanges(missing),
  });
}
