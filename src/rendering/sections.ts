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
 * its own name. A `## ` line with no text left after cleaning is dropped from the output
 * markdown entirely.
 */
export function splitCategoryMarkdown(markdown: string): CategorySections {
  const { source, headings } = findHeadings(markdown);
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

interface FoundHeadings {
  /** The markdown the offsets below index into: the input minus its empty heading lines. */
  source: string;
  headings: HeadingMatch[];
}

/** Own-line `## ` headings with their character offsets, skipping fenced code blocks (the model
 * quotes markdown and diffs, and a `## ` line inside a quoted block must not split anything).
 *
 * A heading that cleans to nothing (`## ###`) names no section, so it is cut out of `source`
 * instead: left in place it would reach the renderer as prose and show up as an empty `<h2>`. */
function findHeadings(markdown: string): FoundHeadings {
  const fences = findFences(markdown);
  const headings: HeadingMatch[] = [];
  const keptLines: string[] = [];
  let offset = 0;
  let keptOffset = 0;
  let fenceIndex = 0;

  for (const rawLine of markdown.split("\n")) {
    // Matched without the `\r`, measured with it, so offsets stay right for CRLF input.
    const line = rawLine.replace(/\r$/, "");
    // Fences and lines are both in document order, so one shared cursor walks them together.
    let fence = fences[fenceIndex];
    while (fence && fence.end <= offset) {
      fenceIndex++;
      fence = fences[fenceIndex];
    }
    const inFence = fence !== undefined && offset >= fence.start;
    const text = inFence ? undefined : H2_PATTERN.exec(line)?.[1];
    const clean = text === undefined ? undefined : cleanHeading(text);

    if (clean === "") {
      offset += rawLine.length + 1;
      continue;
    }
    if (clean !== undefined) {
      headings.push({ index: keptOffset, bodyStart: keptOffset + rawLine.length, text: clean });
    }
    keptLines.push(rawLine);
    offset += rawLine.length + 1;
    keptOffset += rawLine.length + 1;
  }

  return { source: keptLines.join("\n"), headings };
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
