import type { Category, CategoryProposal } from "../categories/types.js";
import { ClaudeOutputError } from "../claude/errors.js";
import type { RunnerDeps } from "../claude/runner.js";
import { resumeSession, runSession } from "../claude/session.js";
import { config } from "../config.js";
import { batchChanges } from "./batch.js";
import { buildBatchClassifyPrompt, buildInitialClassifyPrompt } from "./prompt.js";
import {
  type CategoryAssignment,
  type ClassifiableChange,
  IGNORE_CATEGORY,
  NONE_CATEGORY,
} from "./types.js";
import {
  buildClassifyBatchSchema,
  type ClassifyBatchResponse,
  type RawChangeClassification,
} from "./wire.js";

/**
 * A change's classification, resolved from the classifier's raw reply. A "none" reply (the
 * classifier proposed a new category, or slipped one in alongside real assignments) is left
 * partly unresolved here — `existingAssignments` keeps any real assignments the reply already
 * gave the change, and the escape hatch (see ./escape-hatch.ts) resolves the suggestion itself.
 */
export type ResolvedChange =
  | { kind: "ignored" }
  | { kind: "categorized"; assignments: CategoryAssignment[] }
  | {
      kind: "none";
      suggestedCategory: CategoryProposal;
      existingAssignments: CategoryAssignment[];
    };

/** Result of running the classifier over every batch (escape hatch already resolved per-batch;
 * see {@link AfterBatchHook}), before the final coverage-verification step. */
export interface BatchClassifyResult {
  /** Latest classifier session id — resume from here for coverage-repair follow-ups. */
  sessionId: string;
  /** changeId -> resolved classification. changeIds no reply ever mentioned are simply absent. */
  resolved: Map<string, ResolvedChange>;
  /** Category list as of the last batch — may have grown via escape-hatch acceptances. */
  categories: Category[];
}

/**
 * Called after each batch's reply is resolved, before the next batch's prompt is built. The
 * classifier (see ./orchestrate.ts) wires this to the escape hatch (./escape-hatch.ts), so an
 * accepted new category is already part of `categories` by the time the *next* batch is asked —
 * satisfying "continue classifying remaining batches with the updated list" (spec 5.2).
 */
export type AfterBatchHook = (
  resolved: Map<string, ResolvedChange>,
  classifierSessionId: string,
  categories: Category[],
) => Promise<{
  resolved: Map<string, ResolvedChange>;
  classifierSessionId: string;
  categories: Category[];
}>;

/**
 * Runs the haiku classifier over every batch of `changes`: the first batch via a fresh session
 * (given the full category list and task explanation), later batches resuming that session and
 * restating the (possibly updated) category list. Calls `afterBatch` after each batch to resolve
 * that batch's "none" replies before moving on. Returns every mentioned change's classification.
 */
export async function classifyInBatches(
  categories: Category[],
  changes: ClassifiableChange[],
  afterBatch: AfterBatchHook,
  deps: RunnerDeps = {},
): Promise<BatchClassifyResult> {
  const [firstBatch, ...restBatches] = batchChanges(changes);
  if (!firstBatch) {
    throw new ClaudeOutputError("classifyInBatches was called with no changes to classify");
  }

  const firstResponse = await runSession<ClassifyBatchResponse>(
    {
      model: config.models.classification,
      schema: buildClassifyBatchSchema(categories),
      prompt: buildInitialClassifyPrompt(categories, firstBatch),
    },
    deps,
  );
  let resolved = new Map<string, ResolvedChange>();
  applyRawClassifications(firstResponse.result.classifications, resolved);
  let after = await afterBatch(resolved, firstResponse.sessionId, categories);
  resolved = after.resolved;
  let sessionId = after.classifierSessionId;
  let currentCategories = after.categories;

  for (const batch of restBatches) {
    const response = await resumeSession<ClassifyBatchResponse>(
      {
        sessionId,
        schema: buildClassifyBatchSchema(currentCategories),
        prompt: buildBatchClassifyPrompt(currentCategories, batch),
      },
      deps,
    );
    applyRawClassifications(response.result.classifications, resolved);
    after = await afterBatch(resolved, response.sessionId, currentCategories);
    resolved = after.resolved;
    sessionId = after.classifierSessionId;
    currentCategories = after.categories;
  }

  return { sessionId, resolved, categories: currentCategories };
}

/** Resolves each raw entry and stores it, keyed by changeId (last write wins on duplicates). */
function applyRawClassifications(
  entries: RawChangeClassification[],
  into: Map<string, ResolvedChange>,
): void {
  for (const entry of entries) {
    into.set(entry.changeId, resolveRawClassification(entry));
  }
}

/**
 * Turns one change's raw assignments into a {@link ResolvedChange}: "ignore" (if present) wins
 * over everything else. Otherwise, any real (non-"none") assignments are kept as-is — even
 * alongside a "none" entry, so a model that doesn't follow the "none is exclusive" prompt
 * instruction doesn't silently lose a valid classification. A "none" assignment (which must
 * carry a suggestedCategory) is surfaced for the escape hatch to resolve separately.
 */
export function resolveRawClassification(entry: RawChangeClassification): ResolvedChange {
  if (entry.assignments.some((assignment) => assignment.category === IGNORE_CATEGORY)) {
    return { kind: "ignored" };
  }

  const real = entry.assignments
    .filter((assignment) => assignment.category !== NONE_CATEGORY)
    .map((assignment) => ({ category: assignment.category, codeType: assignment.codeType }));

  const none = entry.assignments.find((assignment) => assignment.category === NONE_CATEGORY);
  if (none) {
    if (!none.suggestedCategory) {
      throw new ClaudeOutputError(
        `claude classified change "${entry.changeId}" as "none" without a suggestedCategory`,
      );
    }
    return { kind: "none", suggestedCategory: none.suggestedCategory, existingAssignments: real };
  }

  return { kind: "categorized", assignments: real };
}
