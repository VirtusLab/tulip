import type { Category } from "../categories/types.js";
import type { RunnerDeps } from "../claude/runner.js";
import { resumeSession } from "../claude/session.js";
import { config } from "../config.js";
import { categoryNamesMatch } from "./category-name.js";
import { type ResolvedChange, resolveRawClassification } from "./classify.js";
import { type ClassificationState, resolveNoneClassifications } from "./escape-hatch.js";
import { buildCoverageRepairPrompt } from "./prompt.js";
import {
  type CategoryAssignment,
  type ClassifiableChange,
  IGNORE_CATEGORY,
  NONE_CATEGORY,
} from "./types.js";
import { CLASSIFY_BATCH_SCHEMA, type ClassifyBatchResponse } from "./wire.js";

/** Coverage repair attempts before giving up (see spec: "ask the classifying agent to classify
 * the missing changes"; the spec sets no cap, this bounds it to avoid an unbounded retry loop). */
const MAX_COVERAGE_REPAIR_ATTEMPTS = config.limits.maxCoverageRepairAttempts;

/** Thrown when changes remain uncovered by any category after every repair attempt. */
export class IncompleteCoverageError extends Error {
  readonly uncovered: ClassifiableChange[];

  constructor(uncovered: ClassifiableChange[]) {
    const ranges = uncovered
      .map((change) => `${change.path} (${change.side} ${change.range.start}-${change.range.end})`)
      .join(", ");
    super(
      `${uncovered.length} change(s) still uncovered by any category after ` +
        `${MAX_COVERAGE_REPAIR_ATTEMPTS} repair attempt(s): ${ranges}`,
    );
    this.name = "IncompleteCoverageError";
    this.uncovered = uncovered;
  }
}

/**
 * Ids of every non-ignored change from `changes` not covered by >= 1 assignment naming a
 * category `categories` actually has (normalized: trimmed, case-insensitive) — an assignment
 * naming a category the classifier invented or misspelled doesn't count as coverage, since it
 * would otherwise silently vanish later in groupChangesByCategory's exact-name matching.
 */
export function findUncoveredChangeIds(
  changes: ClassifiableChange[],
  resolved: Map<string, ResolvedChange>,
  categories: Category[],
): string[] {
  return changes
    .filter((change) => isUncovered(resolved.get(change.id), categories))
    .map((change) => change.id);
}

function isUncovered(entry: ResolvedChange | undefined, categories: Category[]): boolean {
  if (!entry) {
    return true;
  }
  if (entry.kind === "ignored") {
    return false;
  }
  if (entry.kind === "categorized") {
    return !hasKnownAssignment(entry.assignments, categories);
  }
  // kind "none": the escape hatch's suggestion is still unresolved, but any real assignments the
  // reply gave alongside it (see classify.ts's resolveRawClassification) already cover the change.
  return !hasKnownAssignment(entry.existingAssignments, categories);
}

function hasKnownAssignment(assignments: CategoryAssignment[], categories: Category[]): boolean {
  return assignments.some((assignment) => isKnownCategoryName(assignment.category, categories));
}

function isKnownCategoryName(name: string, categories: Category[]): boolean {
  if (categoryNamesMatch(name, IGNORE_CATEGORY) || categoryNamesMatch(name, NONE_CATEGORY)) {
    return true;
  }
  return categories.some((category) => categoryNamesMatch(category.name, name));
}

/**
 * Verifies every non-ignored change is covered by >= 1 category assignment. For any that
 * aren't, resumes the classifier session with just the missing changes (running any resulting
 * "none" replies back through the escape hatch), up to {@link MAX_COVERAGE_REPAIR_ATTEMPTS}
 * times. Throws {@link IncompleteCoverageError} if changes remain uncovered afterward.
 */
export async function verifyAndRepairCoverage(
  changes: ClassifiableChange[],
  changesById: Map<string, ClassifiableChange>,
  resolved: Map<string, ResolvedChange>,
  state: ClassificationState,
  deps: RunnerDeps = {},
): Promise<Map<string, ResolvedChange>> {
  let current = resolved;

  for (let attempt = 0; attempt < MAX_COVERAGE_REPAIR_ATTEMPTS; attempt++) {
    const missing = lookUp(findUncoveredChangeIds(changes, current, state.categories), changesById);
    if (missing.length === 0) {
      return current;
    }

    const response = await resumeSession<ClassifyBatchResponse>(
      {
        sessionId: state.classifierSessionId,
        schema: CLASSIFY_BATCH_SCHEMA,
        prompt: buildCoverageRepairPrompt(state.categories, missing),
      },
      deps,
    );
    state.classifierSessionId = response.sessionId;

    const next = new Map(current);
    for (const raw of response.result.classifications) {
      next.set(raw.changeId, resolveRawClassification(raw));
    }
    current = await resolveNoneClassifications(next, changesById, state, deps);
  }

  const stillMissing = lookUp(
    findUncoveredChangeIds(changes, current, state.categories),
    changesById,
  );
  if (stillMissing.length > 0) {
    throw new IncompleteCoverageError(stillMissing);
  }
  return current;
}

function lookUp(ids: string[], changesById: Map<string, ClassifiableChange>): ClassifiableChange[] {
  return ids
    .map((id) => changesById.get(id))
    .filter((change): change is ClassifiableChange => change !== undefined);
}
