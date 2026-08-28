import type { ClassifiableChange } from "../classification/types.js";
import { renderPrompt } from "../prompts/loader.js";
import type { ExplainCategoryInput, ReviewIssue, ReviewPromptInput } from "./types.js";

/** Text lives in src/prompts/explain-markup-instructions.md (docs/adr/0006). */
const MARKUP_INSTRUCTIONS = renderPrompt("explain-markup-instructions", {});

/** Text lives in src/prompts/explain-production-checklist.md (docs/adr/0006). */
const PRODUCTION_CHECKLIST = renderPrompt("explain-production-checklist", {});

/** Text lives in src/prompts/explain-test-checklist.md (docs/adr/0006). */
const TEST_CHECKLIST = renderPrompt("explain-test-checklist", {});

function formatChange(change: ClassifiableChange, diffThreshold: number): string {
  const location = `${change.path} (${change.status}), side ${change.side}, lines ${change.range.start}-${change.range.end}`;
  // Uses `change.lines` — the full, untruncated diff — never `change.excerpt`, which phase 2
  // (classification) truncates by character count for cheap-model prompts (see
  // src/classification/excerpt.ts). That truncation is unrelated to this threshold and would
  // otherwise wrongly hide changes that are well within it.
  const size = change.range.end - change.range.start + 1;
  if (size <= diffThreshold) {
    return `- ${location}\n  diff:\n  ${change.lines.join("\n  ")}`;
  }
  return `- ${location}\n  (diff omitted: ${size} lines, over the ${diffThreshold}-line threshold —
  reference it by file/side/line-range in your explanation instead of quoting it)`;
}

/** Tells a session what its checkout gives it access to: the head revision's working tree,
 * readable directly with its Read/Grep/Glob tools (no Bash/git access is granted — see
 * src/config.ts's `claude.allowedTools` doc comment for why), plus the full diff and every
 * changed file's pre-change content, both materialized as plain files (see
 * src/github/materialize.ts) so they're freely readable regardless of prompt size. Text lives
 * in src/prompts/checkout-access.md (docs/adr/0006). */
function describeCheckoutAccess(input: { baseSha: string; headSha: string }): string {
  return renderPrompt("checkout-access", {
    baseSha: input.baseSha,
    headSha: input.headSha,
  });
}

function formatChanges(changes: ClassifiableChange[], diffThreshold: number): string {
  if (changes.length === 0) {
    return "(none)";
  }
  return changes.map((change) => formatChange(change, diffThreshold)).join("\n\n");
}

/**
 * Task 6.2: the explaining session's initial prompt. Gives the PR's title/description, explains
 * the task (this is one category among several, explained separately), the category itself, and
 * its changes — full diff excerpt or a file+side+line-range reference only, per
 * `input.diffThreshold`, applied per change (not to the total). Instructs research-then-analyze,
 * then a markdown answer interleaving prose, Mermaid diagrams, and snippet references, split
 * into production/test sections, covering the spec's checklist where relevant, and referencing
 * every provided change at least once. Text lives in src/prompts/explain.md (docs/adr/0006).
 */
export function buildExplainPrompt(input: ExplainCategoryInput): string {
  return renderPrompt("explain", {
    prTitle: input.prTitle,
    prDescription: input.prDescription.trim() || "(no description provided)",
    categoryName: input.category.name,
    categoryDescription: input.category.description,
    markupInstructions: MARKUP_INSTRUCTIONS,
    productionChanges: formatChanges(input.production, input.diffThreshold),
    testChanges: formatChanges(input.test, input.diffThreshold),
    checkoutAccess: describeCheckoutAccess(input),
    productionChecklist: PRODUCTION_CHECKLIST,
    testChecklist: TEST_CHECKLIST,
  });
}

function formatChangeLocation(change: ClassifiableChange): string {
  return `- ${change.path}, side ${change.side}, lines ${change.range.start}-${change.range.end}`;
}

/**
 * Task 6.3: resumes the explaining session after snippet coverage verification found changes it
 * was given but never referenced. Asks for the full amended markdown (not a diff/patch) so the
 * caller can simply replace its copy. Text lives in src/prompts/explain-coverage-amend.md
 * (docs/adr/0006).
 */
export function buildCoverageAmendPrompt(missing: ClassifiableChange[]): string {
  return renderPrompt("explain-coverage-amend", {
    missing: missing.map(formatChangeLocation).join("\n"),
  });
}

/**
 * Task 6.4: a fresh reviewing session's prompt. Reviews for clarity, conciseness, and
 * correctness/groundedness. Gives the reviewer the same changes the explaining session got
 * (same diff-vs-reference threshold logic as ./buildExplainPrompt) — without them, "grounded in
 * the changes" can't actually be checked, only the explanation's internal consistency. Text
 * lives in src/prompts/review.md (docs/adr/0006).
 */
export function buildReviewPrompt(input: ReviewPromptInput): string {
  return renderPrompt("review", {
    prTitle: input.prTitle,
    prDescription: input.prDescription.trim() || "(no description provided)",
    categoryName: input.category.name,
    categoryDescription: input.category.description,
    markdown: input.markdown,
    productionChanges: formatChanges(input.production, input.diffThreshold),
    testChanges: formatChanges(input.test, input.diffThreshold),
    checkoutAccess: describeCheckoutAccess(input),
  });
}

/** Task 6.4: resumes the explaining session with a reviewer's issues, asking for the full
 * amended markdown. Text lives in src/prompts/review-amend.md (docs/adr/0006). */
export function buildReviewAmendPrompt(issues: ReviewIssue[]): string {
  return renderPrompt("review-amend", {
    issues: issues.map((issue) => `- ${issue.description}`).join("\n"),
  });
}
