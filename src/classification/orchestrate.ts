import type { Category } from "../categories/types.js";
import type { RunnerDeps } from "../claude/runner.js";
import type { ParsedDiff } from "../diff/change.js";
import { classifyInBatches, type ResolvedChange } from "./classify.js";
import { verifyAndRepairCoverage } from "./coverage.js";
import { type ClassificationState, resolveNoneClassifications } from "./escape-hatch.js";
import { prepareClassifiableChanges } from "./prepare.js";
import type { CategoryAssignment, ClassifiableChange } from "./types.js";

/** Everything phase 2 needs: the parsed diff, and phase 1's ordered categories + session id. */
export interface ClassifyChangesInput {
  diff: ParsedDiff;
  /** Ordered category list from generateCategories (see src/categories/generate.ts). */
  categories: Category[];
  /** Session id from generateCategories — resumed for escape-hatch consultations. */
  phase1SessionId: string;
}

export interface ClassifyChangesResult {
  /** Final ordered category list: phase-1 categories, then any accepted escape-hatch
   * categories appended in acceptance order. */
  categories: Category[];
  /** changeId -> resolved assignments. Changes classified "ignore" are omitted — see
   * `ignoredChangeIds`. Changes still missing a verdict (not yet an error) simply aren't a key. */
  assignments: Map<string, CategoryAssignment[]>;
  /** changeIds classified "ignore" — excluded from `assignments` and all later phases/rendering. */
  ignoredChangeIds: Set<string>;
  /** Every classifiable change, keyed by id — convenient for grouping/rendering downstream. */
  changesById: Map<string, ClassifiableChange>;
}

/**
 * Runs phase 2 end to end: classifies every change in `diff` (in batches, via haiku), resolves
 * any "none" replies through the phase-1 escape hatch (see ./escape-hatch.ts), then verifies
 * every non-ignored change ended up covered by >= 1 category, repairing gaps by re-asking the
 * classifier (see ./coverage.ts). Throws {@link IncompleteCoverageError} (from ./coverage.js) if
 * coverage still isn't complete after every repair attempt.
 */
export async function classifyChanges(
  input: ClassifyChangesInput,
  deps: RunnerDeps = {},
): Promise<ClassifyChangesResult> {
  const changes = prepareClassifiableChanges(input.diff);
  const changesById = new Map(changes.map((change) => [change.id, change]));

  const batchResult = await classifyInBatches(input.categories, changes, deps);

  const state: ClassificationState = {
    categories: input.categories,
    phase1SessionId: input.phase1SessionId,
    classifierSessionId: batchResult.sessionId,
    acceptedNewCategories: 0,
  };
  const afterEscapeHatch = await resolveNoneClassifications(
    batchResult.resolved,
    changesById,
    state,
    deps,
  );
  const resolved = await verifyAndRepairCoverage(
    changes,
    changesById,
    afterEscapeHatch,
    state,
    deps,
  );

  return {
    categories: state.categories,
    ...splitAssignments(resolved),
    changesById,
  };
}

function splitAssignments(resolved: Map<string, ResolvedChange>): {
  assignments: Map<string, CategoryAssignment[]>;
  ignoredChangeIds: Set<string>;
} {
  const assignments = new Map<string, CategoryAssignment[]>();
  const ignoredChangeIds = new Set<string>();

  for (const [changeId, entry] of resolved) {
    if (entry.kind === "ignored") {
      ignoredChangeIds.add(changeId);
    } else if (entry.kind === "categorized") {
      assignments.set(changeId, entry.assignments);
    }
    // kind "none" cannot remain here: resolveNoneClassifications only returns once none are left.
  }

  return { assignments, ignoredChangeIds };
}
