import { batchBySize } from "../claude/batch.js";
import { config } from "../config.js";
import type { ClassifiableChange } from "./types.js";

/**
 * Groups changes into batches for the classifier: at most `config.limits.maxBatchSize` changes,
 * and at most `config.limits.maxBatchExcerptChars` of excerpt text, per batch. A single change
 * whose own excerpt exceeds the char budget still gets its own (oversized) batch (see
 * {@link batchBySize}).
 */
export function batchChanges(changes: ClassifiableChange[]): ClassifiableChange[][] {
  return batchBySize(
    changes,
    config.limits.maxBatchSize,
    config.limits.maxBatchExcerptChars,
    (change) => change.excerpt.length,
  );
}
