import type { ChangeOwner } from "../classification/group.js";
import type { ClassifiableChange } from "../classification/types.js";
import { renderPrompt } from "../prompts/loader.js";
import { ATTENTION_LABEL } from "../rendering/attention-badge.js";
import type { ExplainCategoryInput, ReviewIssue, ReviewPromptInput } from "./types.js";

/** Text lives in src/prompts/explain-markup-instructions.md (docs/adr/0006). */
const MARKUP_INSTRUCTIONS = renderPrompt("explain-markup-instructions", {});

/** Text lives in src/prompts/explain-production-checklist.md (docs/adr/0006). */
const PRODUCTION_CHECKLIST = renderPrompt("explain-production-checklist", {});

/** Text lives in src/prompts/explain-test-checklist.md (docs/adr/0006). */
const TEST_CHECKLIST = renderPrompt("explain-test-checklist", {});

/** The owner context {@link formatChange} needs to annotate secondary changes (docs/adr/0015):
 * the category being explained and every change's owning category. */
interface SecondaryRefContext {
  categoryId: string;
  owners: ReadonlyMap<string, ChangeOwner>;
}

/** Inline note appended to a change that is *secondary* in the category being explained
 * (docs/adr/0015): owned and explained in full by another category, so it must be linked here
 * rather than re-snippeted. Empty when this category owns the change (it's primary) — and, for
 * safety, when the change has no owner, which can't happen for a matched change. The catref must
 * stay attributed — a bare `{{catref}}` trips the prompt loader (docs/adr/0006). */
function secondaryAnnotation(change: ClassifiableChange, secondary: SecondaryRefContext): string {
  const owner = secondary.owners.get(change.id);
  if (!owner || owner.ownerCategoryId === secondary.categoryId) {
    return "";
  }
  return ` — already explained under "${owner.ownerTitle}": don't add a snippet; say in one line what it does here and link with {{catref id="${owner.ownerCategoryId}"}}`;
}

function formatChange(
  change: ClassifiableChange,
  diffThreshold: number,
  secondary: SecondaryRefContext,
): string {
  const location = `${change.path} (${change.status}), side ${change.side}, lines ${change.range.start}-${change.range.end}${secondaryAnnotation(change, secondary)}`;
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
 * in src/prompts/explain-checkout-access.md (docs/adr/0006). */
function describeCheckoutAccess(input: { baseSha: string; headSha: string }): string {
  return renderPrompt("explain-checkout-access", {
    baseSha: input.baseSha,
    headSha: input.headSha,
  });
}

function formatChanges(
  changes: ClassifiableChange[],
  diffThreshold: number,
  secondary: SecondaryRefContext,
): string {
  if (changes.length === 0) {
    return "(none)";
  }
  return changes.map((change) => formatChange(change, diffThreshold, secondary)).join("\n\n");
}

/**
 * Task 6.2: the explaining session's initial prompt. Gives the PR's title/description, explains
 * the task (this is one category among several, explained separately), the category itself
 * (including its attention rating's label, e.g. "Read closely" — docs/adr/0010/0014 — via
 * `ATTENTION_LABEL`), and its changes — full diff excerpt or a file+side+line-range reference
 * only, per `input.diffThreshold`, applied per change (not to the total). Instructs
 * research-then-analyze, then a markdown answer interleaving prose, Mermaid diagrams, and
 * snippet references, split into production/test sections, covering the spec's checklist where
 * relevant, and referencing every provided change at least once. Text lives in
 * src/prompts/explain.md (docs/adr/0006).
 */
export function buildExplainPrompt(input: ExplainCategoryInput): string {
  const secondary: SecondaryRefContext = {
    categoryId: input.category.id,
    owners: input.changeOwners,
  };
  return renderPrompt("explain", {
    prTitle: input.prTitle,
    prDescription: input.prDescription.trim() || "(no description provided)",
    categoryName: input.category.name,
    attention: ATTENTION_LABEL[input.category.attention],
    categoryDescription: input.category.description,
    markupInstructions: MARKUP_INSTRUCTIONS,
    productionChanges: formatChanges(input.production, input.diffThreshold, secondary),
    testChanges: formatChanges(input.test, input.diffThreshold, secondary),
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
 * Task 6.4: a fresh reviewing session's prompt. Reviews for clarity, conciseness,
 * correctness/groundedness, and fold discipline against the category's attention budget
 * (docs/adr/0014, same `ATTENTION_LABEL` as ./buildExplainPrompt). Gives the reviewer the same
 * changes the explaining session got (same diff-vs-reference threshold logic as
 * ./buildExplainPrompt) — without them, "grounded in the changes" can't actually be checked,
 * only the explanation's internal consistency. Text lives in src/prompts/review.md
 * (docs/adr/0006).
 */
export function buildReviewPrompt(input: ReviewPromptInput): string {
  const secondary: SecondaryRefContext = {
    categoryId: input.category.id,
    owners: input.changeOwners,
  };
  return renderPrompt("review", {
    prTitle: input.prTitle,
    prDescription: input.prDescription.trim() || "(no description provided)",
    categoryName: input.category.name,
    attention: ATTENTION_LABEL[input.category.attention],
    categoryDescription: input.category.description,
    markdown: input.markdown,
    productionChanges: formatChanges(input.production, input.diffThreshold, secondary),
    testChanges: formatChanges(input.test, input.diffThreshold, secondary),
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

/**
 * Resumes the explaining session after mermaid diagram verification (see
 * ./mermaid-verify.ts, docs/adr/0008) found one invalid diagram. Gives it the exact invalid
 * source and the parser's own error, and asks for just the corrected diagram source — a small,
 * targeted fix, not the full markdown, since only one fence needs to change. Text lives in
 * src/prompts/explain-mermaid-fix.md (docs/adr/0006).
 */
export function buildMermaidFixPrompt(source: string, error: string): string {
  return renderPrompt("explain-mermaid-fix", { source, error });
}
