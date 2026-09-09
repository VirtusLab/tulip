import type { ChangeSideContent, FileStatus, LineRange } from "../diff/change.js";

/**
 * Public domain model for phase 2 (change classification). Raw wire types and JSON schemas for
 * talking to the classifier live separately, in ./wire.ts.
 */

/** Whether a change belongs to code that ships, or to the tests that exercise it. */
export type CodeType = "production" | "test";

/** One category a change was placed into, and whether it's production or test code. */
export interface CategoryAssignment {
  /** The category's `id` (see ../categories/types.ts's `Category`), or the "ignore"/"none"
   * sentinel below — never the category's free-text `name`, which the classifier can't be
   * trusted to echo back verbatim (see docs/adr/0005). */
  category: string;
  codeType: CodeType;
}

/**
 * A {@link Change}, carrying everything the classifier prompt needs: which file it came from, that
 * file's status, the change's present side(s) (`base`/`head`, mirroring `Change` — docs/adr/0018),
 * and a ready-to-send diff excerpt (see ./excerpt.ts). At least one of `base`/`head` is present.
 */
export interface ClassifiableChange {
  id: string;
  path: string;
  status: FileStatus;
  base?: ChangeSideContent;
  head?: ChangeSideContent;
  /** Combined diff lines (base then head), `+`/`-` markers included; truncated if very large
   * (see ./excerpt.ts). Later phases needing the full, untruncated diff use {@link changeDiffLines}
   * over the change's own sides instead. */
  excerpt: string;
}

/** Sentinel category names the classifier may use instead of a real category (see spec). */
export const IGNORE_CATEGORY = "ignore";
export const NONE_CATEGORY = "none";

/** A human-readable description of a change's present side ranges, e.g. `base 2-3, head 2-4` or
 * `head 10-14` — used in classifier/explainer prompts and coverage error messages. */
export function changeLocationRanges(change: Pick<ClassifiableChange, "base" | "head">): string {
  const parts: string[] = [];
  if (change.base) {
    parts.push(`base ${change.base.range.start}-${change.base.range.end}`);
  }
  if (change.head) {
    parts.push(`head ${change.head.range.start}-${change.head.range.end}`);
  }
  return parts.join(", ");
}

/** A single range to display a change at (head if present, else base) — for consumers that still
 * need one range, e.g. the phase-1 category consultation (see ./escape-hatch.ts). */
export function changeDisplayRange(change: Pick<ClassifiableChange, "base" | "head">): LineRange {
  const side = change.head ?? change.base;
  if (!side) {
    throw new Error("A change must have at least one of base/head");
  }
  return side.range;
}
