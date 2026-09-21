/** One fenced code block, spanning both fence lines. */
export interface Fence {
  /** Offset of the opening fence line, its indent included. */
  start: number;
  /** Offset just past the closing fence line's last character, its newline excluded — so
   * `slice(start, end)` is the whole block and splicing around it keeps the line ending intact.
   * The end of the input for a fence that is never closed. */
  end: number;
  /** The opener's info string, trimmed; empty when there is none. */
  info: string;
  /** The lines between the fences, without the newline ending the last one. An unterminated
   * fence takes everything after its opening line verbatim. */
  content: string;
}

// CommonMark: at most three spaces of indent (four makes an indented code block), then three or
// more backticks or tildes, then the rest of the line. Greedy, single-quantifier parts only: the
// markdown is untrusted model output, and a lazy group before a trailing quantifier backtracks
// quadratically on a long line.
const FENCE_LINE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * Finds every fenced code block in `markdown`, in document order, as the CommonMark subset the
 * model's output actually uses. Shared by the section parser (which must not split on a `## `
 * line quoted inside a fence) and the Mermaid finder (which splices diagram placeholders over
 * whole blocks), so the two can never disagree on where a code block starts and ends.
 *
 * A closer is a line of the opener's character, at least as long, with nothing but whitespace
 * after it — an info string on it means it is not a closer.
 */
export function findFences(markdown: string): Fence[] {
  const fences: Fence[] = [];
  let open: { start: number; contentStart: number; marker: string; info: string } | undefined;
  let offset = 0;

  for (const rawLine of markdown.split("\n")) {
    // Matched without the `\r`, measured with it, so offsets stay right for CRLF input.
    const line = rawLine.replace(/\r$/, "");
    const match = FENCE_LINE_PATTERN.exec(line);
    const marker = match?.[1] ?? "";
    const rest = match?.[2] ?? "";

    if (open) {
      if (marker[0] === open.marker[0] && marker.length >= open.marker.length && !rest.trim()) {
        fences.push({
          start: open.start,
          end: offset + line.length,
          info: open.info,
          content: markdown.slice(
            open.contentStart,
            contentEnd(markdown, offset, open.contentStart),
          ),
        });
        open = undefined;
      }
    } else if (match && !(marker[0] === "`" && rest.includes("`"))) {
      // A backtick opener's info string may not contain a backtick, so ``` `x` ``` stays a code
      // span rather than opening a block.
      open = {
        start: offset,
        contentStart: offset + rawLine.length + 1,
        marker,
        info: rest.trim(),
      };
    }

    offset += rawLine.length + 1;
  }

  if (open) {
    fences.push({
      start: open.start,
      end: markdown.length,
      info: open.info,
      content: markdown.slice(open.contentStart),
    });
  }
  return fences;
}

/** Where a block's content stops: at the closing fence line, minus the line ending before it. */
function contentEnd(markdown: string, closerOffset: number, contentStart: number): number {
  let end = closerOffset;
  if (end > contentStart && markdown[end - 1] === "\n") {
    end--;
  }
  if (end > contentStart && markdown[end - 1] === "\r") {
    end--;
  }
  return end;
}
