import type { ClassifiableChange } from "./types.js";

/** Max changes per classification call. Bounded further by {@link MAX_BATCH_EXCERPT_CHARS}. */
export const MAX_BATCH_SIZE = 20;

/** Max total excerpt size per classification call, to keep prompts bounded regardless of count. */
export const MAX_BATCH_EXCERPT_CHARS = 20_000;

/**
 * Groups changes into batches for the classifier: at most {@link MAX_BATCH_SIZE} changes, and at
 * most {@link MAX_BATCH_EXCERPT_CHARS} of excerpt text, per batch. A single change whose own
 * excerpt exceeds the char budget still gets its own (oversized) batch, rather than being split.
 */
export function batchChanges(changes: ClassifiableChange[]): ClassifiableChange[][] {
  const batches: ClassifiableChange[][] = [];
  let current: ClassifiableChange[] = [];
  let currentChars = 0;

  for (const change of changes) {
    const wouldExceed =
      current.length > 0 &&
      (current.length >= MAX_BATCH_SIZE ||
        currentChars + change.excerpt.length > MAX_BATCH_EXCERPT_CHARS);
    if (wouldExceed) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(change);
    currentChars += change.excerpt.length;
  }
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}
