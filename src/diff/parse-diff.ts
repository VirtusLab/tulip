import type { Change, DiffSide, FileDiff, FileStatus, LineRange, ParsedDiff } from "./change.js";

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

function parseDiffGitHeader(header: string): { aPath: string; bPath: string } {
  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(header);
  if (!match?.[1] || !match[2]) {
    throw new Error(`Unrecognized diff header: ${header}`);
  }
  return { aPath: match[1], bPath: match[2] };
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

/** Walks one hunk's body lines, grouping consecutive `-`/`+` lines into ranges. */
function parseHunkBody(
  lines: string[],
  baseStart: number,
  headStart: number,
  path: string,
): Change[] {
  const changes: Change[] = [];
  let baseLine = baseStart;
  let headLine = headStart;
  let removed: LineRange | undefined;
  let added: LineRange | undefined;

  const flushRemoved = () => {
    if (removed) {
      changes.push(makeChange(path, "base", removed));
      removed = undefined;
    }
  };
  const flushAdded = () => {
    if (added) {
      changes.push(makeChange(path, "head", added));
      added = undefined;
    }
  };

  for (const line of lines) {
    const marker = line[0];
    if (marker === " ") {
      flushRemoved();
      flushAdded();
      baseLine++;
      headLine++;
    } else if (marker === "-") {
      flushAdded();
      removed = removed
        ? { start: removed.start, end: baseLine }
        : { start: baseLine, end: baseLine };
      baseLine++;
    } else if (marker === "+") {
      flushRemoved();
      added = added ? { start: added.start, end: headLine } : { start: headLine, end: headLine };
      headLine++;
    }
    // Other lines (e.g. "\ No newline at end of file", or the trailing blank split artifact) are ignored.
  }
  flushRemoved();
  flushAdded();
  return changes;
}

function makeChange(path: string, side: DiffSide, range: LineRange): Change {
  return { id: `${path}:${side}:${range.start}-${range.end}`, path, side, range };
}
