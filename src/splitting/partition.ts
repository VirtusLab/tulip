import {
  type Change,
  type ChangeSideContent,
  type DiffSide,
  type LineRange,
  makeChange,
} from "../diff/change.js";
import type { SplitBoundary } from "./wire.js";

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
 * Builds the partition of `change` from the LLM's proposed boundaries — the coverage guarantee of
 * docs/adr/0016 (generalized to two axes by docs/adr/0018): the model only proposes where a new
 * segment begins, and this code tiles each present axis exactly, so no line is dropped or
 * duplicated regardless of what the model returns.
 *
 * A single-sided change (addition/deletion) tiles its one axis from that side's boundary
 * coordinates. A modification tiles BOTH axes from paired boundaries: a boundary is kept only if
 * it carries both a base and a head coordinate, each in its side's `(start, end]` and strictly
 * advancing past the previous kept boundary on both axes — so the axes keep equal segment counts
 * and segment `i` pairs base segment `i` with head segment `i`. A segment with lines on only one
 * side becomes an addition/deletion; with both, a modification. If no usable boundaries remain,
 * `change` passes through whole.
 */
export function buildPartition(change: Change, boundaries: SplitBoundary[]): Change[] {
  if (change.base && change.head) {
    return partitionModification(change, change.base, change.head, boundaries);
  }
  const side: DiffSide = change.head ? "head" : "base";
  const content = change.head ?? change.base;
  if (!content) {
    return [change]; // Unreachable: the ≥1-side invariant guarantees one side is present.
  }
  const points = sanitizePoints(
    boundaries.map((boundary) => boundary[side]),
    content.range,
  );
  if (points.length === 0) {
    return [change];
  }
  return tileSide(change.path, side, content, points);
}

/** Sanitizes single-axis boundary points to integers strictly inside `(start, end]`, deduped and
 * sorted ascending. */
function sanitizePoints(points: (number | undefined)[], range: LineRange): number[] {
  return [
    ...new Set(
      points.filter(
        (point): point is number =>
          point !== undefined &&
          Number.isInteger(point) &&
          point > range.start &&
          point <= range.end,
      ),
    ),
  ].sort((a, b) => a - b);
}

/** Tiles one side's `range` at `points` (each the first line of a new segment) into single-sided
 * sub-changes, slicing `content.lines` to match. `points` must already be sanitized. */
function tileSide(
  path: string,
  side: DiffSide,
  content: ChangeSideContent,
  points: number[],
): Change[] {
  const { start, end } = content.range;
  const boundaries = [start, ...points, end + 1];
  const segments: Change[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const segStart = boundaries[i] as number;
    const segEnd = (boundaries[i + 1] as number) - 1;
    const segment: ChangeSideContent = {
      range: { start: segStart, end: segEnd },
      lines: content.lines.slice(segStart - start, segEnd - start + 1),
    };
    segments.push(makeChange(path, side === "head" ? { head: segment } : { base: segment }));
  }
  return segments;
}

/** Tiles a modification's two axes from paired boundaries (see {@link buildPartition}). */
function partitionModification(
  change: Change,
  base: ChangeSideContent,
  head: ChangeSideContent,
  boundaries: SplitBoundary[],
): Change[] {
  const kept = keepPairedBoundaries(boundaries, base.range, head.range);
  if (kept.length === 0) {
    return [change];
  }

  const baseBoundaries = [base.range.start, ...kept.map((k) => k.base), base.range.end + 1];
  const headBoundaries = [head.range.start, ...kept.map((k) => k.head), head.range.end + 1];
  const segments: Change[] = [];
  for (let i = 0; i < baseBoundaries.length - 1; i++) {
    const baseSeg = sliceSide(
      base,
      baseBoundaries[i] as number,
      (baseBoundaries[i + 1] as number) - 1,
    );
    const headSeg = sliceSide(
      head,
      headBoundaries[i] as number,
      (headBoundaries[i + 1] as number) - 1,
    );
    if (!baseSeg && !headSeg) {
      continue; // Can't happen with strictly-advancing boundaries, but never emit an empty change.
    }
    segments.push(
      makeChange(change.path, {
        ...(baseSeg ? { base: baseSeg } : {}),
        ...(headSeg ? { head: headSeg } : {}),
      }),
    );
  }
  return segments;
}

/** Keeps only boundaries carrying both coordinates, each in its side's `(start, end]` and strictly
 * advancing past the previous kept boundary on both axes; drops the rest (unpaired, out-of-range,
 * non-integer, or non-advancing). Sorted by base then head. */
function keepPairedBoundaries(
  boundaries: SplitBoundary[],
  baseRange: LineRange,
  headRange: LineRange,
): { base: number; head: number }[] {
  const pairs = boundaries
    .filter(
      (boundary): boundary is { base: number; head: number } =>
        boundary.base !== undefined &&
        boundary.head !== undefined &&
        Number.isInteger(boundary.base) &&
        Number.isInteger(boundary.head),
    )
    .sort((a, b) => a.base - b.base || a.head - b.head);

  const kept: { base: number; head: number }[] = [];
  let prevBase = baseRange.start;
  let prevHead = headRange.start;
  for (const pair of pairs) {
    if (
      pair.base > prevBase &&
      pair.base <= baseRange.end &&
      pair.head > prevHead &&
      pair.head <= headRange.end
    ) {
      kept.push(pair);
      prevBase = pair.base;
      prevHead = pair.head;
    }
  }
  return kept;
}

/** One segment's content on a side, or undefined if the segment spans no lines there. */
function sliceSide(
  content: ChangeSideContent,
  segStart: number,
  segEnd: number,
): ChangeSideContent | undefined {
  if (segStart > segEnd) {
    return undefined;
  }
  return {
    range: { start: segStart, end: segEnd },
    lines: content.lines.slice(segStart - content.range.start, segEnd - content.range.start + 1),
  };
}
