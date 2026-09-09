import { type Change, type ChangeSideContent, type DiffSide, makeChange } from "../diff/change.js";

/**
 * True if `change` is large enough to offer to the splitter: its total changed line count across
 * both sides (`base` + `head`) exceeds `threshold`. Any kind qualifies — a large addition,
 * deletion, or in-place modification (docs/adr/0016, generalized by docs/adr/0018).
 */
export function isSplitCandidate(change: Change, threshold: number): boolean {
  const total = (change.base?.lines.length ?? 0) + (change.head?.lines.length ?? 0);
  return total > threshold;
}

/**
 * Builds the partition of `change` from the LLM's interior split points — the coverage guarantee
 * of docs/adr/0016: the model only proposes where a new segment begins, and this code turns those
 * points into a gap-free, overlap-free tiling of the change's range. No line can be dropped or
 * duplicated regardless of what the model returns.
 *
 * Single-sided changes (additions, deletions) tile their one side, as before. A modification (both
 * sides present) passes through whole here — two-axis paired splitting arrives with the
 * `boundaries` wire in a later step (docs/adr/0018); until then a large modification stays one
 * change.
 *
 * `splitBefore` are 1-based side line numbers, each the first line of a new segment. They're
 * sanitized to integers strictly inside `(start, end]`, deduped and sorted; a point at or before
 * `start` is meaningless and one past `end` is out of range — both dropped. If none survive,
 * `change` passes through whole. Otherwise segments are `[start, p1-1], [p1, p2-1], …, [pk, end]`,
 * each sub-change's `lines` sliced at offset `segStart - start` and its id assigned by
 * {@link makeChange}.
 */
export function buildPartition(change: Change, splitBefore: number[]): Change[] {
  if (change.base && change.head) {
    return [change];
  }
  const side: DiffSide = change.head ? "head" : "base";
  const content = change.head ?? change.base;
  if (!content) {
    return [change]; // Unreachable: the ≥1-side invariant guarantees one side is present.
  }

  const { start, end } = content.range;
  const points = [
    ...new Set(splitBefore.filter((p) => Number.isInteger(p) && p > start && p <= end)),
  ].sort((a, b) => a - b);
  if (points.length === 0) {
    return [change];
  }

  // Segment boundaries: the original start, each split point, and the original end+1 as the
  // exclusive tail — so segment i spans [boundaries[i], boundaries[i+1]-1] and they tile exactly.
  const boundaries = [start, ...points, end + 1];
  const segments: Change[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const segStart = boundaries[i] as number;
    const segEnd = (boundaries[i + 1] as number) - 1;
    const segment: ChangeSideContent = {
      range: { start: segStart, end: segEnd },
      lines: content.lines.slice(segStart - start, segEnd - start + 1),
    };
    segments.push(makeChange(change.path, side === "head" ? { head: segment } : { base: segment }));
  }
  return segments;
}
