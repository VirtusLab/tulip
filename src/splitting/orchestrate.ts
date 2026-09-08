import type { Category } from "../categories/types.js";
import { batchBySize } from "../claude/batch.js";
import type { RunnerDeps } from "../claude/runner.js";
import { runSession } from "../claude/session.js";
import { config } from "../config.js";
import type { ParsedDiff } from "../diff/change.js";
import { createLogger, type Logger } from "../logging/logger.js";
import { buildPartition, isSplitCandidate } from "./partition.js";
import { buildSplitPrompt, type SplitCandidate } from "./prompt.js";
import { SPLIT_SCHEMA, type SplitResponse } from "./wire.js";

/** Everything the split phase needs: the parsed diff and the PR's (reviewed) category list. */
export interface SplitLargeChangesInput {
  diff: ParsedDiff;
  categories: Category[];
}

export interface SplitLargeChangesDeps extends RunnerDeps {
  /** Defaults to a fresh non-verbose logger. Used only for the fail-soft warning below. */
  logger?: Logger;
}

/** Full diff text of a candidate, the size unit its batches are bounded by. */
function diffTextSize(candidate: SplitCandidate): number {
  return candidate.change.lines.join("\n").length;
}

/**
 * Splits over-threshold changes into per-concern sub-changes (docs/adr/0016), running between
 * category review and classification. Each candidate `Change` (line count above
 * `config.limits.splitThreshold`, either side) is offered to a fresh sonnet session that proposes
 * interior split points; {@link buildPartition} turns those into a gap-free tiling, so coverage is
 * guaranteed regardless of the model's output. Returns a new {@link ParsedDiff} with candidates
 * replaced by their sub-changes, in place, preserving file and change order and every
 * `FileDiff` field (`status`, `previousPath`, `binary`).
 *
 * Best-effort by design: a batch whose session fails is logged and left unsplit — coverage is
 * unaffected (those changes simply flow through whole), and splitting only improves grouping
 * quality, so it must never abort the pipeline.
 */
export async function splitLargeChanges(
  input: SplitLargeChangesInput,
  deps: SplitLargeChangesDeps = {},
): Promise<ParsedDiff> {
  const logger = deps.logger ?? createLogger();
  const candidates: SplitCandidate[] = input.diff.files.flatMap((file) =>
    file.changes
      .filter((change) => isSplitCandidate(change, config.limits.splitThreshold))
      .map((change) => ({ change, status: file.status })),
  );
  if (candidates.length === 0) {
    return input.diff;
  }

  const batches = batchBySize(
    candidates,
    config.limits.maxBatchSize,
    config.limits.maxSplitBatchDiffChars,
    diffTextSize,
  );

  const splitBefore = new Map<string, number[]>();
  for (const batch of batches) {
    try {
      const { result } = await runSession<SplitResponse>(
        {
          model: config.models.changeSplitting,
          schema: SPLIT_SCHEMA,
          prompt: buildSplitPrompt({ categories: input.categories, candidates: batch }),
        },
        deps,
      );
      for (const split of result.splits) {
        // An unknown changeId (not one we asked about) is simply never looked up in the rebuild
        // below, so storing it is harmless; buildPartition sanitizes the numbers.
        splitBefore.set(split.changeId, split.splitBefore);
      }
    } catch (error) {
      logger.info(
        `warning: splitting a batch of ${batch.length} large change(s) failed; leaving them ` +
          `unsplit: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    files: input.diff.files.map((file) => ({
      ...file,
      changes: file.changes.flatMap((change) =>
        buildPartition(change, splitBefore.get(change.id) ?? []),
      ),
    })),
  };
}
