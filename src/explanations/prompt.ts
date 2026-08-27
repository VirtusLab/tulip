import type { Category } from "../categories/types.js";
import type { ClassifiableChange } from "../classification/types.js";
import type { ExplainCategoryInput, ReviewIssue } from "./types.js";

const MARKUP_INSTRUCTIONS = `To reference source code, use this exact markup, on its own line:

{{snippet path="<file path>" side="base|head" lines="<start>-<end>" unfold="yes|no"}}

- path: the file's path, exactly as given below.
- side: "base" for the code before the PR, "head" for the code after.
- lines: the 1-based inclusive line range, exactly as given below (e.g. "10-14").
- unfold: "yes" if the snippet is important enough to show expanded by default; "no" if it's a
  supporting/secondary change the reviewer only needs to expand on demand.

Never paste code directly into your explanation — always use this markup instead. A renderer
will substitute it with the real, syntax-highlighted code afterwards.`;

const PRODUCTION_CHECKLIST = `For the production code, cover what's relevant — skip what doesn't apply:
- how it relates to the PR's title and description
- what functionality is implemented
- the main algorithms and data structures used
- external services used, and how
- the code's complexity — CPU and memory
- whether it touches mutable state (especially global mutable state), and other side effects
- old vs. new call-stack diagrams (as Mermaid sequence diagrams), if the flow of calls changed
- any new dependencies, and why they're needed
- whether this is a refactor (and so trivial to review), and what refactorings are involved
- any documentation added or changed, and what kind`;

const TEST_CHECKLIST = `For the test code, cover what's relevant:
- whether the tests are unit or integration tests
- whether they exercise the functionality as a whole, or in isolated pieces
- whether they overlap with each other
- whether they require external resources
- the testing approach — e.g. example-based, property-based, mutation testing`;

function formatChange(change: ClassifiableChange, diffThreshold: number): string {
  const location = `${change.path} (${change.status}), side ${change.side}, lines ${change.range.start}-${change.range.end}`;
  const size = change.excerpt.split("\n").length;
  if (size <= diffThreshold) {
    return `- ${location}\n  diff:\n  ${change.excerpt.split("\n").join("\n  ")}`;
  }
  return `- ${location}\n  (diff omitted: ${size} lines, over the ${diffThreshold}-line threshold —
  reference it by file/side/line-range in your explanation instead of quoting it)`;
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
 * every provided change at least once.
 */
export function buildExplainPrompt(input: ExplainCategoryInput): string {
  return `You are explaining part of a pull request to a human reviewer, so they can review it
efficiently. The PR has been split into categories of related changes; this is one category.
Other categories will be explained separately, in their own sessions — don't worry about
repeating context for them.

PR title: ${input.prTitle}

PR description:
${input.prDescription.trim() || "(no description provided)"}

Category: ${input.category.name}
${input.category.description}

${MARKUP_INSTRUCTIONS}

Production code changes in this category:
${formatChanges(input.production, input.diffThreshold)}

Test code changes in this category:
${formatChanges(input.test, input.diffThreshold)}

First research the changes above — read through them and understand what they do. Then analyze
how they work; jotting down scratch notes for yourself is fine, but only your final answer
matters.

Then write the explanation as markdown, interleaving prose with Mermaid diagrams (fenced with
\`\`\`mermaid) and snippet references. Use diagrams generously, including before/after
call-sequence diagrams wherever the flow of calls changed. Split the explanation into two
sections, "## Production code" and "## Test code" (the latter covering the testing strategy) —
omit whichever section has nothing to say.

${PRODUCTION_CHECKLIST}

${TEST_CHECKLIST}

It's up to you to judge which of the above points actually apply to this category — skip what
doesn't, don't force it.

EVERY change listed above MUST appear as a snippet reference somewhere in your explanation — that
is how the reviewer gets to see the actual code. Mark supporting changes (not crucial to
understanding the category on its own) with unfold="no"; mark the important ones unfold="yes".`;
}

function formatChangeLocation(change: ClassifiableChange): string {
  return `- ${change.path}, side ${change.side}, lines ${change.range.start}-${change.range.end}`;
}

/**
 * Task 6.3: resumes the explaining session after snippet coverage verification found changes it
 * was given but never referenced. Asks for the full amended markdown (not a diff/patch) so the
 * caller can simply replace its copy.
 */
export function buildCoverageAmendPrompt(missing: ClassifiableChange[]): string {
  return `Your explanation didn't include a snippet reference for every change you were given.
These are missing a {{snippet ...}} reference somewhere in the explanation:

${missing.map(formatChangeLocation).join("\n")}

Reply with the full, amended markdown (not just the missing part) — add snippet references for
these changes wherever they best fit in the existing explanation. Keep everything else the same.`;
}

/**
 * Task 6.4: a fresh reviewing session's prompt. Reviews for clarity, conciseness, and
 * correctness/groundedness, per the brief's exact context list — PR title/description, category
 * name, the explanation markdown, and this goal.
 */
export function buildReviewPrompt(
  prTitle: string,
  prDescription: string,
  category: Category,
  markdown: string,
): string {
  return `You are reviewing an explanation written for a human reviewer of part of a pull
request.

PR title: ${prTitle}

PR description:
${prDescription.trim() || "(no description provided)"}

Category being explained: ${category.name}
${category.description}

Here is the explanation:

${markdown}

Review it for:
- clarity — is it easy to follow for a reviewer who hasn't seen the code yet?
- conciseness — is anything unnecessary or repetitive?
- correctness — is everything grounded in the changes it's supposed to explain, with nothing
  invented or mistaken?

Reply with approved: true if it's good as-is. Otherwise reply with approved: false and a list of
specific issues to fix.`;
}

/** Task 6.4: resumes the explaining session with a reviewer's issues, asking for the full
 * amended markdown. */
export function buildReviewAmendPrompt(issues: ReviewIssue[]): string {
  return `A reviewer looked at your explanation and raised these issues:

${issues.map((issue) => `- ${issue.description}`).join("\n")}

Reply with the full, amended markdown that addresses them. Keep your existing snippet
references unless an issue specifically requires changing them.`;
}
