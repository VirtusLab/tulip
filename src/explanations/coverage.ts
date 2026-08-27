import type { ClassifiableChange } from "../classification/types.js";
import type { RunnerDeps } from "../claude/runner.js";
import { resumeSession } from "../claude/session.js";
import { config } from "../config.js";
import type { LineRange } from "../diff/change.js";
import { parseSnippetRefs, type SnippetRef } from "./markup.js";
import { buildCoverageAmendPrompt } from "./prompt.js";
import { EXPLANATION_SCHEMA, type ExplanationResponse } from "./wire.js";

/** Amend attempts before giving up (spec sets no cap: "resume the explaining session and ask it
 * to amend"; this bounds it to avoid an unbounded retry loop — mirrors classification coverage's
 * maxCoverageRepairAttempts, see src/classification/coverage.ts). */
const MAX_SNIPPET_COVERAGE_ATTEMPTS = config.limits.maxSnippetCoverageAttempts;

/** Thrown when changes remain unreferenced by any snippet after every amend attempt. */
export class SnippetCoverageError extends Error {
  readonly missing: ClassifiableChange[];

  constructor(missing: ClassifiableChange[]) {
    const ranges = missing
      .map((change) => `${change.path} (${change.side} ${change.range.start}-${change.range.end})`)
      .join(", ");
    super(
      `${missing.length} change(s) still not referenced by any snippet after ` +
        `${MAX_SNIPPET_COVERAGE_ATTEMPTS} amend attempt(s): ${ranges}`,
    );
    this.name = "SnippetCoverageError";
    this.missing = missing;
  }
}

/**
 * Changes from `changes` whose full line range isn't covered by the union of same file+side
 * snippet references found in `markdown`. Task 6.3's core check.
 */
export function findUnreferencedChanges(
  markdown: string,
  changes: ClassifiableChange[],
): ClassifiableChange[] {
  const refs = parseSnippetRefs(markdown).map((match) => match.ref);
  return changes.filter((change) => !isCovered(change, refs));
}

function isCovered(change: ClassifiableChange, refs: SnippetRef[]): boolean {
  const sameLocation = refs.filter((ref) => ref.path === change.path && ref.side === change.side);
  const merged = mergeRanges(sameLocation.map((ref) => ref.lines));
  return merged.some((range) => range.start <= change.range.start && range.end >= change.range.end);
}

/** Merges overlapping or adjacent ranges, sorted by start. */
function mergeRanges(ranges: LineRange[]): LineRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: LineRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end + 1) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/**
 * Task 6.3: verifies every change in `changes` is referenced by >= 1 snippet ref in `markdown`
 * (its line range fully covered by same-file+side refs). For any that aren't, resumes the
 * explaining session listing the missing changes and asking it to amend, up to
 * {@link MAX_SNIPPET_COVERAGE_ATTEMPTS} times. Throws {@link SnippetCoverageError} if changes
 * remain unreferenced afterward.
 */
export async function verifySnippetCoverage(
  markdown: string,
  sessionId: string,
  changes: ClassifiableChange[],
  deps: RunnerDeps = {},
): Promise<{ markdown: string; sessionId: string }> {
  let currentMarkdown = markdown;
  let currentSessionId = sessionId;

  for (let attempt = 0; attempt < MAX_SNIPPET_COVERAGE_ATTEMPTS; attempt++) {
    const missing = findUnreferencedChanges(currentMarkdown, changes);
    if (missing.length === 0) {
      return { markdown: currentMarkdown, sessionId: currentSessionId };
    }

    const response = await resumeSession<ExplanationResponse>(
      {
        sessionId: currentSessionId,
        schema: EXPLANATION_SCHEMA,
        prompt: buildCoverageAmendPrompt(missing),
      },
      deps,
    );
    currentMarkdown = response.result.markdown;
    currentSessionId = response.sessionId;
  }

  const stillMissing = findUnreferencedChanges(currentMarkdown, changes);
  if (stillMissing.length > 0) {
    throw new SnippetCoverageError(stillMissing);
  }
  return { markdown: currentMarkdown, sessionId: currentSessionId };
}
