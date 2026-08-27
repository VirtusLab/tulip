import type { RunnerDeps } from "../claude/runner.js";
import { resumeSession } from "../claude/session.js";
import { type ResolvedChange, resolveRawClassification } from "./classify.js";
import { type ClassificationState, resolveNoneClassifications } from "./escape-hatch.js";
import { buildCoverageRepairPrompt } from "./prompt.js";
import {
  CLASSIFY_BATCH_SCHEMA,
  type ClassifiableChange,
  type ClassifyBatchResponse,
} from "./types.js";

/** Coverage repair attempts before giving up (see spec: "ask the classifying agent to classify
 * the missing changes"; the spec sets no cap, this bounds it to avoid an unbounded retry loop). */
export const MAX_COVERAGE_REPAIR_ATTEMPTS = 3;

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

/** Ids of every non-ignored change from `changes` not covered by >=1 category assignment. */
export function findUncoveredChangeIds(
  changes: ClassifiableChange[],
  resolved: Map<string, ResolvedChange>,
): string[] {
  return changes
    .filter((change) => isUncovered(resolved.get(change.id)))
    .map((change) => change.id);
}

function isUncovered(entry: ResolvedChange | undefined): boolean {
  if (!entry) {
    return true;
  }
  if (entry.kind === "ignored") {
    return false;
  }
  if (entry.kind === "categorized") {
    return entry.assignments.length === 0;
  }
  // kind "none": the escape hatch's suggestion is still unresolved, but any real assignments the
  // reply gave alongside it (see classify.ts's resolveRawClassification) already cover the change.
  return entry.existingAssignments.length === 0;
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
    const missing = lookUp(findUncoveredChangeIds(changes, current), changesById);
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

  const stillMissing = lookUp(findUncoveredChangeIds(changes, current), changesById);
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
