import type { Category } from "../categories/types.js";
import type { ClassifiableChange } from "./types.js";

function formatCategoryList(categories: Category[]): string {
  return categories.map((category) => `- ${category.name}: ${category.description}`).join("\n");
}

function formatChange(change: ClassifiableChange): string {
  return `- id: ${change.id}
  file: ${change.path} (${change.status})
  side: ${change.side}, lines ${change.range.start}-${change.range.end}
  diff:
  ${change.excerpt.split("\n").join("\n  ")}`;
}

function formatChanges(changes: ClassifiableChange[]): string {
  return changes.map(formatChange).join("\n\n");
}

const SPECIAL_CATEGORIES_EXPLANATION = `Two special categories are also available:
- "ignore": use this for generated files, lockfiles, or binaries — anything a human
  wouldn't review. When you use "ignore", make it the change's only assignment.
- "none": use this if the change genuinely doesn't fit any category above. You MUST
  also include a "suggestedCategory" with a name and description for a new category
  that would fit it. Only use "none" as a last resort.`;

const OUTPUT_INSTRUCTIONS = `For each change, reply with its id and a list of assignments. Each
assignment has a category (one of the names above, or "ignore"/"none") and a codeType
("production" or "test"). A change usually needs just one assignment, but list more than one
if it genuinely belongs to multiple categories. Give every change at least one assignment,
unless you're marking it "ignore".`;

/** First classification call: explains the categories and the task, then lists the first batch. */
export function buildInitialClassifyPrompt(
  categories: Category[],
  batch: ClassifiableChange[],
): string {
  return `You are classifying the changes in a pull request into categories, so each
change ends up grouped with the others that belong to the same piece of functionality.

The categories to classify changes into are:
${formatCategoryList(categories)}

${SPECIAL_CATEGORIES_EXPLANATION}

${OUTPUT_INSTRUCTIONS}

Here is the first batch of changes to classify:

${formatChanges(batch)}`;
}

/** A later batch, within the same classification session — categories are already known. */
export function buildBatchClassifyPrompt(batch: ClassifiableChange[]): string {
  return `Here is the next batch of changes to classify, using the same categories
as before:

${formatChanges(batch)}`;
}

/** One change's escape-hatch outcome, for {@link buildEscapeHatchResumePrompt}. */
export interface EscapeHatchOutcome {
  change: ClassifiableChange;
  accepted: boolean;
  category?: Category;
}

function formatEscapeHatchOutcome(outcome: EscapeHatchOutcome): string {
  const verdict = outcome.accepted
    ? `Your suggested new category was accepted, and refined to "${outcome.category?.name}". ` +
      "You may use it now, or still pick a different existing category if it fits better."
    : "Your suggested new category was NOT accepted. Pick from the current category list " +
      'below instead — do not reply "none" for this change.';
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
  return `The category list is now:
${formatCategoryList(categories)}

Here's what happened with the new categories you proposed:

${outcomes.map(formatEscapeHatchOutcome).join("\n\n")}

Reply with an updated classification for just these changes.`;
}
