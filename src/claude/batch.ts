/**
 * Groups `items` into batches bounded by both a count (`maxCount`) and a total size (`maxChars`,
 * via `sizeOf`), to keep each `claude` prompt within limits. A single item whose own size exceeds
 * `maxChars` still forms its own (oversized) batch rather than being dropped — so there is always
 * at least one item per batch.
 *
 * Shared by the phases that batch LLM calls: classification (src/classification/batch.ts, sized by
 * excerpt length) and change-splitting (src/splitting, sized by full diff text) — same
 * size-bounding shape, different size source.
 */
export function batchBySize<T>(
  items: T[],
  maxCount: number,
  maxChars: number,
  sizeOf: (item: T) => number,
): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let currentChars = 0;

  for (const item of items) {
    const size = sizeOf(item);
    const wouldExceed =
      current.length > 0 && (current.length >= maxCount || currentChars + size > maxChars);
    if (wouldExceed) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(item);
    currentChars += size;
  }
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}
