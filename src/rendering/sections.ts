import { findFences } from "./fences.js";

/** Which heading family a subsection's text matched (docs/adr/0022): `test` and `docs` for the
 * headings the explaining prompt reserves, `main` for anything else. */
export type SubsectionKind = "main" | "test" | "docs";

export interface CategorySubsection {
  kind: SubsectionKind;
  /** Heading text with a trailing colon and closing `#`s trimmed, e.g. "Tests". */
  heading: string;
  /** Markdown body between this heading and the next (or end of string), heading line stripped. */
  markdown: string;
}

/** One category's markdown, split into its `## ` subsections plus any leading text. */
export interface CategorySections {
  /** Markdown before the first `## ` heading: the big-picture lead-in the prompt asks for, so
   * this is the normal case, not an exception. */
  intro: string;
  subsections: CategorySubsection[];
}

// The mandatory blank after `##` is what keeps `###` from matching. Greedy, single-quantifier
// patterns only: the model's output is untrusted, and a lazy group before a trailing quantifier
// backtracks quadratically on a long line.
const H2_PATTERN = /^##[ \t]+(.+)$/;

// Keys are lowercase. "test code" is the pre-ADR-0003 heading, kept because it costs nothing.
const KIND_BY_HEADING = new Map<string, SubsectionKind>([
  ["tests", "test"],
  ["test", "test"],
  ["testing", "test"],
  ["test code", "test"],
  ["documentation", "docs"],
  ["docs", "docs"],
]);

/**
 * Splits a category's explanation markdown at every own-line `## ` heading outside a fenced code
 * block. `#` and `###` headings never split. Test and docs headings are recognized through a
 * short synonym list so a drifted heading still folds; anything else is a main section under
 * its own name. A `## ` line with no text left after cleaning is blanked out of the returned
 * markdown, so it renders as nothing.
 */
export function splitCategoryMarkdown(markdown: string): CategorySections {
  const source = blankEmptyHeadings(markdown);
  const headings = findHeadings(source);
  const first = headings[0];
  if (!first) {
    return { intro: source, subsections: [] };
  }
  const subsections = headings.map((heading, i) => ({
    kind: KIND_BY_HEADING.get(heading.text.toLowerCase()) ?? "main",
    heading: heading.text,
    markdown: source.slice(heading.bodyStart, headings[i + 1]?.index ?? source.length),
  }));
  return { intro: source.slice(0, first.index), subsections };
}

interface HeadingMatch {
  /** Offset of the heading line. */
  index: number;
  /** Offset of the heading line's newline, so every body starts with it. */
  bodyStart: number;
  text: string;
}

/** Empties every `## ` line that cleans to nothing (`## ###`). Such a line names no section, and
 * left alone it reaches the renderer as prose and shows up as an empty `<h2>`. The line is kept,
 * blank, rather than removed: joining its neighbours could make the one above a setext heading. */
function blankEmptyHeadings(markdown: string): string {
  const lines = [...eachLine(markdown)].map((line) => (headingOf(line) === "" ? "" : line.raw));
  return lines.join("\n");
}

/** Own-line `## ` headings with their character offsets into `markdown`. */
function findHeadings(markdown: string): HeadingMatch[] {
  const headings: HeadingMatch[] = [];
  for (const line of eachLine(markdown)) {
    const text = headingOf(line);
    if (text) {
      headings.push({ index: line.offset, bodyStart: line.offset + line.raw.length, text });
    }
  }
  return headings;
}

/** This line's cleaned `## ` heading text, or undefined if it is not one. */
function headingOf(line: SourceLine): string | undefined {
  if (line.inFence) {
    return undefined;
  }
  const text = H2_PATTERN.exec(line.text)?.[1];
  return text === undefined ? undefined : cleanHeading(text);
}

interface SourceLine {
  /** The line as it appears in the source, a trailing `\r` included. */
  raw: string;
  /** The same line without that `\r`, so patterns match alike on LF and CRLF input. */
  text: string;
  /** Offset of the line's first character. */
  offset: number;
  inFence: boolean;
}

/** Walks `markdown` line by line, telling each line whether it falls inside a fenced code block —
 * the model quotes markdown and diffs, and a `## ` line inside a quoted block must not split
 * anything. */
function* eachLine(markdown: string): Generator<SourceLine> {
  const fences = findFences(markdown);
  let fenceIndex = 0;
  let offset = 0;
  for (const raw of markdown.split("\n")) {
    // Fences and lines are both in document order, so one cursor walks them together.
    let fence = fences[fenceIndex];
    while (fence && fence.end <= offset) {
      fenceIndex++;
      fence = fences[fenceIndex];
    }
    yield {
      raw,
      text: raw.replace(/\r$/, ""),
      offset,
      inFence: fence !== undefined && offset >= fence.start,
    };
    offset += raw.length + 1;
  }
}

/** Strips a closed-ATX tail (`## Tests ##`) and a trailing colon (`## Tests:`). The `#`s must
 * follow whitespace, so `## Why F#` keeps its `#`. */
function cleanHeading(text: string): string {
  let heading = text.trim();
  let end = heading.length;
  while (end > 0 && heading[end - 1] === "#") {
    end--;
  }
  if (
    end < heading.length &&
    (end === 0 || heading[end - 1] === " " || heading[end - 1] === "\t")
  ) {
    heading = heading.slice(0, end).trimEnd();
  }
  return heading.replace(/:$/, "").trimEnd();
}
