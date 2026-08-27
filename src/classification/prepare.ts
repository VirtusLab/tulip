import type { ParsedDiff } from "../diff/change.js";
import { buildExcerpt } from "./excerpt.js";
import type { ClassifiableChange } from "./types.js";

/**
 * Flattens a parsed diff into the flat list of changes phase 2 classifies. Binary files carry
 * no `Change`s (see `ParsedDiff`), so they're naturally absent here too — nothing to review, and
 * therefore nothing that needs an "ignore" verdict from the classifier.
 */
export function prepareClassifiableChanges(diff: ParsedDiff): ClassifiableChange[] {
  return diff.files.flatMap((file) =>
    file.changes.map((change) => ({
      id: change.id,
      path: change.path,
      status: file.status,
      side: change.side,
      range: change.range,
      excerpt: buildExcerpt(change),
    })),
  );
}
