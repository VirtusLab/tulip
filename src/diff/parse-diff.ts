import {
  type Change,
  type ChangeSideContent,
  type FileDiff,
  type FileStatus,
  makeChange,
  type ParsedDiff,
} from "./change.js";

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Parses a unified diff (as produced by `git diff` / `gh pr diff`) into the change model:
 * one {@link FileDiff} per touched file, each holding its added/removed line ranges.
 */
export function parseDiff(diffText: string): ParsedDiff {
  const lines = diffText.split("\n");
  const files = splitIntoFileBlocks(lines).map(parseFileBlock);
  return { files };
}

/** Splits diff text into one line-array per `diff --git` file header. */
function splitIntoFileBlocks(lines: string[]): string[][] {
  const blocks: string[][] = [];
  let current: string[] | undefined;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      current = [line];
      blocks.push(current);
    } else if (current) {
      current.push(line);
    }
  }
  return blocks;
}

function parseFileBlock(lines: string[]): FileDiff {
  const header = lines[0] ?? "";
  const firstHunkIndex = lines.findIndex((line) => line.startsWith("@@"));
  const metaLines = lines.slice(1, firstHunkIndex === -1 ? lines.length : firstHunkIndex);
  const hunkLines = firstHunkIndex === -1 ? [] : lines.slice(firstHunkIndex);

  let status: FileStatus = "modified";
  let binary = false;
  let renameFrom: string | undefined;
  let renameTo: string | undefined;
  let minusLine: string | undefined;
  let plusLine: string | undefined;

  for (const line of metaLines) {
    if (line.startsWith("new file mode")) {
      status = "added";
    } else if (line.startsWith("deleted file mode")) {
      status = "removed";
    } else if (line.startsWith("rename from ")) {
      status = "renamed";
      renameFrom = line.slice("rename from ".length);
    } else if (line.startsWith("rename to ")) {
      renameTo = line.slice("rename to ".length);
    } else if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      binary = true;
    } else if (line.startsWith("--- ")) {
      minusLine = line;
    } else if (line.startsWith("+++ ")) {
      plusLine = line;
    }
  }

  const headerPaths = parseDiffGitHeader(header);
  const aPath = renameFrom ?? extractPath(minusLine, "--- ") ?? headerPaths.aPath;
  const bPath = renameTo ?? extractPath(plusLine, "+++ ") ?? headerPaths.bPath;
  const path = status === "removed" ? aPath : bPath;

  const fileDiff: FileDiff = {
    path,
    status,
    binary,
    changes: binary ? [] : parseHunks(hunkLines, path),
  };
  if (status === "renamed" && aPath !== bPath) {
    fileDiff.previousPath = aPath;
  }
  return fileDiff;
}

const DIFF_HEADER_PREFIX = "diff --git a/";
const B_SEPARATOR = " b/";

/**
 * Splits a `diff --git a/<aPath> b/<bPath>` header. Only used as a fallback when neither the
 * `---`/`+++` lines nor `rename from`/`rename to` are present (e.g. a mode-only change).
 *
 * Non-renamed files use the *same* path on both sides, so a path that itself contains " b/"
 * (e.g. "x b/y.txt") can't be split correctly by just finding *a* " b/" — we instead search for
 * the split point where the text before and after it are equal. Renamed files (where a/b
 * genuinely differ) are resolved via `rename from`/`rename to` instead, so a wrong split here is
 * harmless for them.
 */
function parseDiffGitHeader(header: string): { aPath: string; bPath: string } {
  if (!header.startsWith(DIFF_HEADER_PREFIX)) {
    throw new Error(`Unrecognized diff header: ${header}`);
  }
  const rest = header.slice(DIFF_HEADER_PREFIX.length); // "<aPath> b/<bPath>"

  let searchFrom = 0;
  for (
    let idx = rest.indexOf(B_SEPARATOR);
    idx !== -1;
    idx = rest.indexOf(B_SEPARATOR, searchFrom)
  ) {
    const candidateA = rest.slice(0, idx);
    const candidateB = rest.slice(idx + B_SEPARATOR.length);
    if (candidateA === candidateB) {
      return { aPath: candidateA, bPath: candidateB };
    }
    searchFrom = idx + 1;
  }

  const naive = /^(.+) b\/(.+)$/.exec(rest);
  if (!naive?.[1] || !naive[2]) {
    throw new Error(`Unrecognized diff header: ${header}`);
  }
  return { aPath: naive[1], bPath: naive[2] };
}

/** Extracts the path from a `--- a/path` / `+++ b/path` line; undefined for `/dev/null`. */
function extractPath(line: string | undefined, marker: "--- " | "+++ "): string | undefined {
  if (line === undefined) {
    return undefined;
  }
  const raw = line.slice(marker.length).trim();
  if (raw === "/dev/null") {
    return undefined;
  }
  return raw.replace(/^[ab]\//, "");
}

function parseHunks(lines: string[], path: string): Change[] {
  const changes: Change[] = [];
  let i = 0;
  while (i < lines.length) {
    const match = HUNK_HEADER.exec(lines[i] ?? "");
    if (!match?.[1] || !match[2]) {
      i++;
      continue;
    }
    const baseStart = Number(match[1]);
    const headStart = Number(match[2]);
    i++;
    const body: string[] = [];
    while (i < lines.length && !(lines[i] ?? "").startsWith("@@")) {
      body.push(lines[i] ?? "");
      i++;
    }
    changes.push(...parseHunkBody(body, baseStart, headStart, path));
  }
  return changes;
}

/**
 * Walks one hunk's body lines, grouping an adjacent removed-run + added-run into ONE change (a
 * modification), per docs/adr/0018. The rule, on a single group `{ removed?, added? }`:
 *   - context (`" "`): flush the group (a modification/deletion/addition ends here); advance both.
 *   - `"-"`: if an added run is already open, flush first — a `-` after additions starts a new
 *     group (so `+a -b` stays an addition then a deletion, and `-a +b -c +d` is two modifications);
 *     otherwise append to the removed run.
 *   - `"+"`: append to the added run; a `+` never flushes a pending removed run — the two pair into
 *     one modification (`-a -b +c +d` is a single modification).
 * At end, flush. `flush` builds the change from whichever side(s) are present: both → modification,
 * base only → deletion, head only → addition. Line-number tracking is per-marker, independent of
 * grouping.
 */
function parseHunkBody(
  lines: string[],
  baseStart: number,
  headStart: number,
  path: string,
): Change[] {
  const changes: Change[] = [];
  let baseLine = baseStart;
  let headLine = headStart;
  let removed: ChangeSideContent | undefined;
  let added: ChangeSideContent | undefined;

  const flush = () => {
    if (removed || added) {
      changes.push(
        makeChange(path, {
          ...(removed ? { base: removed } : {}),
          ...(added ? { head: added } : {}),
        }),
      );
      removed = undefined;
      added = undefined;
    }
  };

  for (const line of lines) {
    const marker = line[0];
    if (marker === " ") {
      flush();
      baseLine++;
      headLine++;
    } else if (marker === "-") {
      if (added) {
        flush();
      }
      removed = removed
        ? { range: { start: removed.range.start, end: baseLine }, lines: [...removed.lines, line] }
        : { range: { start: baseLine, end: baseLine }, lines: [line] };
      baseLine++;
    } else if (marker === "+") {
      added = added
        ? { range: { start: added.range.start, end: headLine }, lines: [...added.lines, line] }
        : { range: { start: headLine, end: headLine }, lines: [line] };
      headLine++;
    }
    // Other lines (e.g. "\ No newline at end of file", or the trailing blank split artifact) are ignored.
  }
  flush();
  return changes;
}
