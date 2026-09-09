import { type Change, type ChangeSides, makeChange } from "../diff/change.js";
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
 * docs/adr/0016 (generalized to any change kind by docs/adr/0018): the model only proposes where a
 * new segment begins, and this code slices the change's unified sequence exactly, so no line is
 * dropped or duplicated regardless of what the model returns.
 *
 * The unified sequence is `changeDiffLines(change)` — the base (removed) run at positions
 * `[0, baseLen)`, then the head (added) run at `[baseLen, total)`. Each boundary `{ side, line }`
 * maps to a unified position; the sequence is cut at those positions into contiguous slices. A
 * slice wholly in the base run is a deletion, wholly in the head run an addition, and one that
 * straddles the junction a modification — so a cut at the head's first line (position `baseLen`)
 * peels the deletions into their own piece. If no usable boundaries remain, `change` passes through
 * whole.
 */
export function buildPartition(change: Change, boundaries: SplitBoundary[]): Change[] {
  const baseLen = change.base?.lines.length ?? 0;
  const headLen = change.head?.lines.length ?? 0;
  const total = baseLen + headLen;

  const positions = sanitizePositions(change, boundaries, baseLen, total);
  if (positions.length === 0) {
    return [change];
  }

  const cuts = [0, ...positions, total];
  const segments: Change[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i] as number;
    const b = cuts[i + 1] as number;
    const sides: ChangeSides = {};
    if (a < baseLen && change.base) {
      const end = Math.min(b, baseLen);
      sides.base = {
        range: { start: change.base.range.start + a, end: change.base.range.start + end - 1 },
        lines: change.base.lines.slice(a, end),
      };
    }
    if (b > baseLen && change.head) {
      const start = Math.max(a, baseLen) - baseLen;
      const end = b - baseLen;
      sides.head = {
        range: { start: change.head.range.start + start, end: change.head.range.start + end - 1 },
        lines: change.head.lines.slice(start, end),
      };
    }
    segments.push(makeChange(change.path, sides));
  }
  return segments;
}

/**
 * Maps each in-range boundary to its unified position, then dedupes, keeps only strictly-interior
 * positions (`0 < position < total`), and sorts ascending. A boundary is in range when its `side`
 * is present on the change and `line` is an integer within that side's inclusive `[start, end]`.
 *
 * Inclusive-`[start, end]` then `0 < position < total` is what keeps a modification's junction cut
 * `{ head, headStart }` (position `baseLen`) while dropping a head-only change's `headStart`
 * (position 0) as a no-op. Base positions land in `[0, baseLen-1]` and head positions in
 * `[baseLen, total-1]`, so the two sides never collide.
 */
function sanitizePositions(
  change: Change,
  boundaries: SplitBoundary[],
  baseLen: number,
  total: number,
): number[] {
  const positions = new Set<number>();
  for (const { side, line } of boundaries) {
    const content = side === "base" ? change.base : change.head;
    if (
      !content ||
      !Number.isInteger(line) ||
      line < content.range.start ||
      line > content.range.end
    ) {
      continue;
    }
    const position =
      side === "base" ? line - content.range.start : baseLen + (line - content.range.start);
    if (position > 0 && position < total) {
      positions.add(position);
    }
  }
  return [...positions].sort((a, b) => a - b);
}
