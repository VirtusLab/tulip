import {
  type Change,
  type ChangeSideContent,
  changeDiffLines,
  type DiffSide,
  type ParsedDiff,
} from "../diff/change.js";
import { buildExcerpt } from "./excerpt.js";
import type { ClassifiableChange } from "./types.js";

/**
 * Flattens a parsed diff into the flat list of changes phase 2 classifies. Binary files carry
 * no `Change`s (see `ParsedDiff`), so they're naturally absent here too — nothing to review, and
 * therefore nothing that needs an "ignore" verdict from the classifier.
 *
 * Bridge (docs/adr/0018, removed in a later step): a modification is now one `Change` with two
 * sides, but `ClassifiableChange` is still single-sided (`side`/`range`), so it's mapped through
 * its longer side (see {@link longerSide}); `lines`/`excerpt` carry the full combined diff. This
 * already fixes the duplicate-diff bug at the source — a modification is a single classifiable
 * change, rendered once.
 */
export function prepareClassifiableChanges(diff: ParsedDiff): ClassifiableChange[] {
  return diff.files.flatMap((file) =>
    file.changes.map((change) => {
      const longer = longerSide(change);
      return {
        id: change.id,
        path: change.path,
        status: file.status,
        side: longer.side,
        range: longer.content.range,
        excerpt: buildExcerpt(change),
        lines: changeDiffLines(change),
      };
    }),
  );
}

/** The change's longer side (tie → head), used as the single side of the bridged
 * `ClassifiableChange` above. A single-sided change has only that side. */
function longerSide(change: Change): { side: DiffSide; content: ChangeSideContent } {
  const baseLen = change.base?.lines.length ?? 0;
  const headLen = change.head?.lines.length ?? 0;
  if (change.head && headLen >= baseLen) {
    return { side: "head", content: change.head };
  }
  // Either `head` is absent (a deletion) or `base` is the longer side — in both cases `base` is
  // present by the ≥1-side invariant.
  return { side: "base", content: change.base as ChangeSideContent };
}
