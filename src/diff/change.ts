/** Which side of the diff a line range belongs to: the PR's base (before) or head (after) revision. */
export type DiffSide = "base" | "head";

/** A contiguous, 1-based inclusive line range on one side of a file, as it appears in the diff. */
export interface LineRange {
  start: number;
  end: number;
}

/**
 * A single contiguous run of added or removed lines, within one file, on one side of the diff.
 * This is the addressable unit later epics classify into categories and code type; each has a
 * stable id so bookkeeping (e.g. tracking which changes have been categorized) can reference it.
 */
export interface Change {
  /** Stable within a parsed diff: `${path}:${side}:${start}-${end}`. */
  id: string;
  /** Path of the file this change belongs to, on the given `side`. */
  path: string;
  side: DiffSide;
  range: LineRange;
  /** Raw diff lines for this range, one per line, each still carrying its leading `+`/`-` marker. */
  lines: string[];
}

/** How a file was touched by the PR, per the diff's file header. */
export type FileStatus = "added" | "removed" | "modified" | "renamed";

/** All changes to a single file. */
export interface FileDiff {
  /** Head-side path (post-change); for a removed file, this is the base-side path. */
  path: string;
  /** Base-side path, present only when the file was renamed. */
  previousPath?: string;
  status: FileStatus;
  /** True for binary files: no line content, `changes` is empty. */
  binary: boolean;
  changes: Change[];
}

export interface ParsedDiff {
  files: FileDiff[];
}

/** The canonical `Change.id` string for a range on one side of a file: `${path}:${side}:${start}-${end}`
 * (docs/adr/0005). The single source of this format — both the diff parser (src/diff/parse-diff.ts)
 * and the splitter (src/splitting/partition.ts) build ids through it, so sub-changes are keyed
 * identically to parser-produced ones. */
export function changeId(path: string, side: DiffSide, range: LineRange): string {
  return `${path}:${side}:${range.start}-${range.end}`;
}
