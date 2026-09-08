import { type Change, changeId } from "../diff/change.js";

/**
 * True if `change` is large enough to offer to the splitter: its line count
 * (`range.end - range.start + 1`) exceeds `threshold`. Both sides qualify, so a large deletion
 * is a candidate too (docs/adr/0016).
 */
export function isSplitCandidate(change: Change, threshold: number): boolean {
  return change.range.end - change.range.start + 1 > threshold;
}

/**
 * Builds the partition of `change` from the LLM's interior split points — the coverage guarantee
 * of docs/adr/0016: the model only proposes where a new segment begins, and this code turns those
 * points into a gap-free, overlap-free tiling of `change.range`. No line can be dropped or
 * duplicated regardless of what the model returns.
 *
 * `splitBefore` are 1-based side line numbers, each the first line of a new segment. They're
 * sanitized to integers strictly inside `(range.start, range.end]`, deduped and sorted; a point
 * at or before `range.start` is meaningless (it wouldn't start a new interior segment) and one
 * past `range.end` is out of range — both dropped. If none survive, `change` passes through whole
 * (returned as-is). Otherwise segments are `[start, p1-1], [p1, p2-1], …, [pk, end]`, each
 * sub-change's `lines` sliced at offset `segStart - range.start`, `side`/`path` inherited, and id
 * assigned by {@link changeId} (same format as the parser's, docs/adr/0005).
 */
export function buildPartition(change: Change, splitBefore: number[]): Change[] {
  const { start, end } = change.range;
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
    const range = { start: segStart, end: segEnd };
    segments.push({
      id: changeId(change.path, change.side, range),
      path: change.path,
      side: change.side,
      range,
      lines: change.lines.slice(segStart - start, segEnd - start + 1),
    });
  }
  return segments;
}
