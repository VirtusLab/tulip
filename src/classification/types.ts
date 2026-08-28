import type { DiffSide, FileStatus, LineRange } from "../diff/change.js";

/**
 * Public domain model for phase 2 (change classification). Raw wire types and JSON schemas for
 * talking to the classifier live separately, in ./wire.ts.
 */

/** Whether a change belongs to code that ships, or to the tests that exercise it. */
export type CodeType = "production" | "test";

/** One category a change was placed into, and whether it's production or test code. */
export interface CategoryAssignment {
  category: string;
  codeType: CodeType;
}

/**
 * A {@link Change}, flattened with everything the classifier prompt needs: which file it came
 * from, that file's status, and a ready-to-send diff excerpt (see ./excerpt.ts).
 */
export interface ClassifiableChange {
  id: string;
  path: string;
  status: FileStatus;
  side: DiffSide;
  range: LineRange;
  /** Diff lines for this range, `+`/`-` markers included; truncated if very large (see ./excerpt.ts). */
  excerpt: string;
  /** Full, untruncated diff lines for this range — the underlying `Change.lines`, kept separate
   * from `excerpt` so later phases can always show the real diff regardless of `excerpt`'s
   * char-based truncation (see src/explanations/prompt.ts). */
  lines: string[];
}

/** Sentinel category names the classifier may use instead of a real category (see spec). */
export const IGNORE_CATEGORY = "ignore";
export const NONE_CATEGORY = "none";
