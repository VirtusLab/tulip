import type { Category } from "../categories/types.js";
import { ClaudeOutputError } from "../claude/errors.js";
import type { RunnerDeps } from "../claude/runner.js";
import { resumeSession, runSession } from "../claude/session.js";
import { batchChanges } from "./batch.js";
import { buildBatchClassifyPrompt, buildInitialClassifyPrompt } from "./prompt.js";
import {
  type CategoryAssignment,
  CLASSIFY_BATCH_SCHEMA,
  type ClassifiableChange,
  type ClassifyBatchResponse,
  IGNORE_CATEGORY,
  NONE_CATEGORY,
  type RawChangeClassification,
} from "./types.js";

/**
 * A change's classification, resolved from the classifier's raw reply. A "none" reply (the
 * classifier couldn't fit the change into any existing category) is left unresolved here — the
 * escape hatch (see ./escape-hatch.ts) turns it into either "ignored" or "categorized".
 */
export type ResolvedChange =
  | { kind: "ignored" }
  | { kind: "categorized"; assignments: CategoryAssignment[] }
  | { kind: "none"; suggestedCategory: Category };

/** Result of running the classifier over every batch, before the escape hatch / coverage steps. */
export interface BatchClassifyResult {
  /** Latest classifier session id — resume from here for escape-hatch / coverage follow-ups. */
  sessionId: string;
  /** changeId -> resolved classification. changeIds the reply didn't mention are simply absent. */
  resolved: Map<string, ResolvedChange>;
}

/**
 * Runs the haiku classifier over every batch of `changes`: the first batch via a fresh session
 * (given the full category list and task explanation), later batches resuming that session so
 * it keeps the category list and prior context. Returns each mentioned change's classification,
 * resolved from the raw reply (see {@link resolveRawClassification}).
 */
export async function classifyInBatches(
  categories: Category[],
  changes: ClassifiableChange[],
  deps: RunnerDeps = {},
): Promise<BatchClassifyResult> {
  const batches = batchChanges(changes);
  if (batches.length === 0) {
    throw new ClaudeOutputError("classifyInBatches was called with no changes to classify");
  }

  const resolved = new Map<string, ResolvedChange>();
  let sessionId: string | undefined;

  for (const [index, batch] of batches.entries()) {
    const prompt =
      index === 0 ? buildInitialClassifyPrompt(categories, batch) : buildBatchClassifyPrompt(batch);
    const response =
      sessionId === undefined
        ? await runSession<ClassifyBatchResponse>(
            { model: "haiku", schema: CLASSIFY_BATCH_SCHEMA, prompt },
            deps,
          )
        : await resumeSession<ClassifyBatchResponse>(
            { sessionId, schema: CLASSIFY_BATCH_SCHEMA, prompt },
            deps,
          );
    sessionId = response.sessionId;
    applyRawClassifications(response.result.classifications, resolved);
  }

  if (sessionId === undefined) {
    // Unreachable: batches.length > 0 was checked above, so the loop ran at least once.
    throw new ClaudeOutputError("classifyInBatches produced no session id");
  }
  return { sessionId, resolved };
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
 * over everything else; otherwise a "none" assignment (which must carry a suggestedCategory)
 * takes over; otherwise every assignment becomes a category/codeType pair as-is.
 */
export function resolveRawClassification(entry: RawChangeClassification): ResolvedChange {
  if (entry.assignments.some((assignment) => assignment.category === IGNORE_CATEGORY)) {
    return { kind: "ignored" };
  }

  const none = entry.assignments.find((assignment) => assignment.category === NONE_CATEGORY);
  if (none) {
    if (!none.suggestedCategory) {
      throw new ClaudeOutputError(
        `claude classified change "${entry.changeId}" as "none" without a suggestedCategory`,
      );
    }
    return { kind: "none", suggestedCategory: none.suggestedCategory };
  }

  return {
    kind: "categorized",
    assignments: entry.assignments.map((assignment) => ({
      category: assignment.category,
      codeType: assignment.codeType,
    })),
  };
}
