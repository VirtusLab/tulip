import { consultOnCategory } from "../categories/consult.js";
import type { Category } from "../categories/types.js";
import type { RunnerDeps } from "../claude/runner.js";
import { resumeSession } from "../claude/session.js";
import { type ResolvedChange, resolveRawClassification } from "./classify.js";
import { buildEscapeHatchResumePrompt, type EscapeHatchOutcome } from "./prompt.js";
import {
  CLASSIFY_BATCH_SCHEMA,
  type ClassifiableChange,
  type ClassifyBatchResponse,
} from "./types.js";

/** Cap on new categories accepted per run — the spec sets no cap; this exists to bound runaway
 * escape-hatch consultation. After the cap, further "none" proposals are treated as rejected
 * without consulting phase 1 at all. */
export const MAX_ACCEPTED_NEW_CATEGORIES = 5;

/** Mutable state threaded through escape-hatch resolution and coverage repair. */
export interface ClassificationState {
  /** Current (possibly extended) category list, in presentation order. */
  categories: Category[];
  /** Phase-1 (category-generating) session id — consult this for new-category proposals. */
  phase1SessionId: string;
  /** Classifier (phase-2) session id — resume this for follow-up classification requests. */
  classifierSessionId: string;
  acceptedNewCategories: number;
}

/**
 * Resolves every "none" entry currently in `resolved`, in a single pass: consults the phase-1
 * session on each proposed new category (see src/categories/consult.ts), then resumes the
 * classifier once, telling it what was decided about each and asking it to reclassify just those
 * changes. Does not retry — a change that comes back "none" again (or isn't mentioned in the
 * reply) is left as-is; the caller (coverage verification, see ./coverage.ts, which already
 * re-asks missing/uncovered changes up to its own attempt cap) is the backstop for that. Mutates
 * and returns `state`.
 */
export async function resolveNoneClassifications(
  resolved: Map<string, ResolvedChange>,
  changesById: Map<string, ClassifiableChange>,
  state: ClassificationState,
  deps: RunnerDeps = {},
): Promise<Map<string, ResolvedChange>> {
  const noneChangeIds = [...resolved.entries()]
    .filter(([, value]) => value.kind === "none")
    .map(([changeId]) => changeId);
  if (noneChangeIds.length === 0) {
    return resolved;
  }

  const outcomes = await consultOnEach(noneChangeIds, resolved, changesById, state, deps);
  const response = await resumeSession<ClassifyBatchResponse>(
    {
      sessionId: state.classifierSessionId,
      schema: CLASSIFY_BATCH_SCHEMA,
      prompt: buildEscapeHatchResumePrompt(state.categories, outcomes),
    },
    deps,
  );
  state.classifierSessionId = response.sessionId;

  const next = new Map(resolved);
  for (const raw of response.result.classifications) {
    next.set(raw.changeId, resolveRawClassification(raw));
  }
  return next;
}

/**
 * Consults the phase-1 session once per "none" change, in order (chaining each consultation's
 * returned sessionId into the next, per src/categories/consult.ts's contract). Once the
 * new-category cap is reached, remaining proposals are rejected without a consultation call.
 */
async function consultOnEach(
  changeIds: string[],
  resolved: Map<string, ResolvedChange>,
  changesById: Map<string, ClassifiableChange>,
  state: ClassificationState,
  deps: RunnerDeps,
): Promise<EscapeHatchOutcome[]> {
  const outcomes: EscapeHatchOutcome[] = [];

  for (const changeId of changeIds) {
    const entry = resolved.get(changeId);
    const change = changesById.get(changeId);
    if (!change || !entry || entry.kind !== "none") {
      continue; // Not expected: changeId came from filtering `resolved` for kind "none" above.
    }

    if (state.acceptedNewCategories >= MAX_ACCEPTED_NEW_CATEGORIES) {
      outcomes.push({ change, accepted: false });
      continue;
    }

    const consultation = await consultOnCategory(
      {
        sessionId: state.phase1SessionId,
        proposedName: entry.suggestedCategory.name,
        change: { path: change.path, range: change.range, excerpt: change.excerpt },
      },
      deps,
    );
    state.phase1SessionId = consultation.sessionId;

    if (consultation.accept && consultation.category) {
      state.categories = [...state.categories, consultation.category];
      state.acceptedNewCategories++;
      outcomes.push({ change, accepted: true, category: consultation.category });
    } else {
      outcomes.push({ change, accepted: false });
    }
  }

  return outcomes;
}
