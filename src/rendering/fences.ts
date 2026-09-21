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
  /** The lines between the fences, without the line ending before the closer — or before the
   * end of the input, for a fence nothing closes. Each line has up to the opener's indent
   * stripped, as CommonMark requires, so an indented block's content reads unindented. */
  content: string;
}

// CommonMark: at most three spaces of indent (four makes an indented code block), then three or
// more backticks or tildes, then the rest of the line. Greedy, single-quantifier parts only: the
// markdown is untrusted model output, and a lazy group before a trailing quantifier backtracks
// quadratically on a long line.
const FENCE_LINE_PATTERN = /^( {0,3})(`{3,}|~{3,})(.*)$/;

/**
 * Finds every fenced code block in `markdown`, in document order — a deliberate subset of
 * CommonMark, covering what the model's output actually uses. Shared by the section parser
 * (which must not split on a `## ` line quoted inside a fence) and the Mermaid finder (which
 * splices diagram placeholders over whole blocks), so the two can never disagree on where a
 * code block starts and ends.
 *
 * A closer is a line of the opener's character, at least as long, with nothing but whitespace
 * after it — an info string on it means it is not a closer.
 */
export function findFences(markdown: string): Fence[] {
  const fences: Fence[] = [];
  let open: OpenFence | undefined;
  let offset = 0;

  for (const rawLine of markdown.split("\n")) {
    // Matched without the `\r`, measured with it, so offsets stay right for CRLF input.
    const line = rawLine.replace(/\r$/, "");
    const match = FENCE_LINE_PATTERN.exec(line);
    const marker = match?.[2] ?? "";
    const rest = match?.[3] ?? "";
    // A backtick opener's info string may not contain a backtick, so ``` `x` ``` stays a code
    // span rather than opening a block.
    const opens = match !== null && !(marker[0] === "`" && rest.includes("`"));

    if (open) {
      if (
        match &&
        marker[0] === open.marker[0] &&
        marker.length >= open.marker.length &&
        !rest.trim()
      ) {
        fences.push({
          start: open.start,
          end: offset + line.length,
          info: open.info,
          content: contentOf(markdown, open, offset),
        });
        open = undefined;
      }
    } else if (opens) {
      open = {
        start: offset,
        contentStart: offset + rawLine.length + 1,
        marker,
        info: rest.trim(),
        indent: match[1]?.length ?? 0,
      };
    }

    offset += rawLine.length + 1;
  }

  if (open) {
    fences.push({
      start: open.start,
      end: markdown.length,
      info: open.info,
      content: contentOf(markdown, open, markdown.length),
    });
  }
  return fences;
}

interface OpenFence {
  start: number;
  /** Offset of the first content line. */
  contentStart: number;
  marker: string;
  info: string;
  /** Leading spaces on the opening fence line. */
  indent: number;
}

/** A block's content: up to `contentEnd` — the closing fence line, or the end of the input —
 * minus the line ending just before it, and minus the opener's indent on every line. */
function contentOf(markdown: string, open: OpenFence, contentEnd: number): string {
  const content = markdown.slice(open.contentStart, contentEnd).replace(/\r?\n$/, "");
  if (open.indent === 0) {
    return content;
  }
  return content
    .split("\n")
    .map((line) => stripIndent(line, open.indent))
    .join("\n");
}

/** Removes up to `indent` leading spaces; a tab is not indentation here. */
function stripIndent(line: string, indent: number): string {
  let start = 0;
  while (start < indent && line[start] === " ") {
    start++;
  }
  return line.slice(start);
}
