import type { ClassifiableChange } from "../classification/types.js";
import type { ExplainCategoryInput, ReviewIssue, ReviewPromptInput } from "./types.js";

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
 * src/github/materialize.ts) so they're freely readable regardless of prompt size. */
function describeCheckoutAccess(input: { baseSha: string; headSha: string }): string {
  return `Your working directory is a checkout of the PR's head revision (commit
${input.headSha}) — you can read any changed or unchanged file there directly, whether or not
it's excerpted above. The complete unified diff for the whole PR is at .tulip/pr.diff — read or
grep it for the full picture beyond what's excerpted above. The pre-change content (commit
${input.baseSha}) of every changed file is under .tulip/base/<path> (e.g. src/foo.ts's base
version is at .tulip/base/src/foo.ts). Files added by the PR have no base version; files removed
by the PR have no working-tree (head) copy at all — their only content is under
.tulip/base/<path>. Reading a file's .tulip/base copy alongside its checked-out (head) copy, plus
.tulip/pr.diff, is the most reliable way to understand exactly what changed and why.`;
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

${describeCheckoutAccess(input)}

First research the changes above — read through the actual files to understand what they do.
Then analyze how they work; jotting down scratch notes for yourself is fine, but only
your final answer matters.

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
 * correctness/groundedness. Gives the reviewer the same changes the explaining session got
 * (same diff-vs-reference threshold logic as ./buildExplainPrompt) — without them, "grounded in
 * the changes" can't actually be checked, only the explanation's internal consistency.
 */
export function buildReviewPrompt(input: ReviewPromptInput): string {
  return `You are reviewing an explanation written for a human reviewer of part of a pull
request.

PR title: ${input.prTitle}

PR description:
${input.prDescription.trim() || "(no description provided)"}

Category being explained: ${input.category.name}
${input.category.description}

Here is the explanation:

${input.markdown}

Here are the actual changes the explanation is supposed to cover — use these to check the
explanation's claims, not just its internal consistency:

Production code changes in this category:
${formatChanges(input.production, input.diffThreshold)}

Test code changes in this category:
${formatChanges(input.test, input.diffThreshold)}

${describeCheckoutAccess(input)} Use this to verify claims against the actual code too, not just
against the change list above.

Review the explanation for:
- clarity — is it easy to follow for a reviewer who hasn't seen the code yet?
- conciseness — is anything unnecessary or repetitive?
- correctness — does every claim actually match the changes above? Flag anything invented,
  mistaken, or unsupported by them.

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
