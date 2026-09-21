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

// The mandatory blank after `##` is what keeps `###` from matching; the tail is optional so a
// bare `##` is seen too, and blanked below rather than left to render as an empty heading.
// Greedy, single-quantifier patterns only: the model's output is untrusted, and a lazy group
// before a trailing quantifier backtracks quadratically on a long line.
const H2_PATTERN = /^##([ \t].*)?$/gm;

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
  // Two passes, each scanning fences afresh: blanking only empties lines that are already
  // outside every fence, so it cannot move a fence boundary the second pass would see.
  const blanked = blankEmptyHeadings(markdown);
  const headings = findHeadings(blanked);
  const first = headings[0];
  if (!first) {
    return { intro: blanked, subsections: [] };
  }
  const subsections = headings.map((heading, i) => ({
    kind: KIND_BY_HEADING.get(heading.text.toLowerCase()) ?? "main",
    heading: heading.text,
    markdown: blanked.slice(heading.bodyStart, headings[i + 1]?.index ?? blanked.length),
  }));
  return { intro: blanked.slice(0, first.index), subsections };
}

interface HeadingMatch {
  /** Offset of the heading line. */
  index: number;
  /** Offset of the heading line's newline, so every body starts with it. */
  bodyStart: number;
  text: string;
}

/** Empties every `##` line that cleans to nothing — `##`, `## `, `## ###`. Such a line names no
 * section, and left alone it reaches the renderer as prose and shows up as an empty `<h2>`. The
 * line is kept, blank, rather than removed: joining its neighbours could make the one above a
 * setext heading. */
function blankEmptyHeadings(markdown: string): string {
  let blanked = "";
  let copiedTo = 0;
  for (const match of headingMatches(markdown)) {
    if (cleanHeading(match[1] ?? "") !== "") {
      continue;
    }
    // `$` stops before a CRLF line's `\r`, so the `\r` is outside the match and survives —
    // dropping it would leave the document with one lone LF.
    blanked += markdown.slice(copiedTo, match.index);
    copiedTo = match.index + match[0].length;
  }
  return blanked + markdown.slice(copiedTo);
}

/** Own-line `## ` headings with their character offsets into `markdown`. */
function findHeadings(markdown: string): HeadingMatch[] {
  const headings: HeadingMatch[] = [];
  for (const match of headingMatches(markdown)) {
    const text = cleanHeading(match[1] ?? "");
    if (text) {
      // `$` stops before a CRLF line's `\r`, so step over it: the heading line owns its `\r`,
      // and every body starts at the newline.
      const lineEnd = match.index + match[0].length;
      const bodyStart = markdown[lineEnd] === "\r" ? lineEnd + 1 : lineEnd;
      headings.push({ index: match.index, bodyStart, text });
    }
  }
  return headings;
}

/** Every own-line `##` match outside a fenced code block: the model quotes markdown and diffs,
 * and a `## ` line inside a quoted block must not split anything. */
function* headingMatches(markdown: string): Generator<RegExpExecArray> {
  const fences = findFences(markdown);
  let fenceIndex = 0;
  for (const match of markdown.matchAll(H2_PATTERN)) {
    // Fences and matches are both in document order, so one cursor walks them together.
    let fence = fences[fenceIndex];
    while (fence && fence.end <= match.index) {
      fenceIndex++;
      fence = fences[fenceIndex];
    }
    if (fence === undefined || match.index < fence.start) {
      yield match;
    }
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
