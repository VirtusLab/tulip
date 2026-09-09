/** Which side of the diff a line range belongs to: the PR's base (before) or head (after) revision. */
export type DiffSide = "base" | "head";

/** A contiguous, 1-based inclusive line range on one side of a file, as it appears in the diff. */
export interface LineRange {
  start: number;
  end: number;
}

/** One side's content of a {@link Change}: the line range it spans on that side, and the raw diff
 * lines for it — each still carrying its leading `+` (head) or `-` (base) marker. */
export interface ChangeSideContent {
  range: LineRange;
  lines: string[];
}

/**
 * A single change within one file, carrying both sides of the diff it represents (docs/adr/0018).
 * At least one of `base`/`head` is present (enforced by {@link makeChange}); the kind is *derived*
 * from which sides are present, never stored — see {@link changeKind}:
 *   - head only → an addition, base only → a deletion, both → an in-place modification.
 * A modification's `base` (removed) and `head` (added) runs together form one before/after diff, so
 * one change maps to exactly one rendered diff. Each change has a stable id (see {@link changeId}).
 */
export interface Change {
  id: string;
  path: string;
  base?: ChangeSideContent;
  head?: ChangeSideContent;
}

/** A change's derived kind (see {@link changeKind}). */
export type ChangeKind = "addition" | "deletion" | "modification";

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

/** The present sides of a change or a change-to-be — the shape {@link changeId}/{@link makeChange}
 * build an id and a {@link Change} from. */
export interface ChangeSides {
  base?: ChangeSideContent;
  head?: ChangeSideContent;
}

/** The kind of `change`, derived from which sides are present (never stored — docs/adr/0018). */
export function changeKind(change: ChangeSides): ChangeKind {
  if (change.base && change.head) {
    return "modification";
  }
  return change.head ? "addition" : "deletion";
}

/** A change's diff lines as one unified run: base (removed) lines first, then head (added) lines,
 * each keeping its `+`/`-` marker. For a single-sided change this is just that side's lines. */
export function changeDiffLines(change: ChangeSides): string[] {
  return [...(change.base?.lines ?? []), ...(change.head?.lines ?? [])];
}

/**
 * The canonical `Change.id` for the given present side(s) (docs/adr/0005, extended by docs/adr/0018):
 *   - addition (head only): `${path}:head:${hs}-${he}`
 *   - deletion (base only): `${path}:base:${bs}-${be}`
 *   - modification (both):  `${path}:mod:${bs}-${be}:${hs}-${he}`
 * The single source of this format — the diff parser (src/diff/parse-diff.ts) and the splitter
 * (src/splitting/partition.ts) build ids only through here, so sub-changes are keyed identically to
 * parser-produced ones. The id is opaque everywhere and never parsed. Throws if no side is present.
 */
export function changeId(path: string, sides: ChangeSides): string {
  const { base, head } = sides;
  if (base && head) {
    return `${path}:mod:${base.range.start}-${base.range.end}:${head.range.start}-${head.range.end}`;
  }
  if (head) {
    return `${path}:head:${head.range.start}-${head.range.end}`;
  }
  if (base) {
    return `${path}:base:${base.range.start}-${base.range.end}`;
  }
  throw new Error(`Cannot build a change id with no side present (path: ${path})`);
}

/**
 * Builds a {@link Change} from its present side(s), assigning the id via {@link changeId}. Enforces
 * the model's core invariant: throws if neither `base` nor `head` is given.
 */
export function makeChange(path: string, sides: ChangeSides): Change {
  if (!sides.base && !sides.head) {
    throw new Error(`A change must have at least one of base/head (path: ${path})`);
  }
  const change: Change = { id: changeId(path, sides), path };
  if (sides.base) {
    change.base = sides.base;
  }
  if (sides.head) {
    change.head = sides.head;
  }
  return change;
}
