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
// CommonMark allows a fence to be indented by up to three spaces.
const FENCE_PATTERN = /^[ \t]{0,3}(`{3,}|~{3,})/;

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
 * its own name.
 */
export function splitCategoryMarkdown(markdown: string): CategorySections {
  const headings = findHeadings(markdown);
  const first = headings[0];
  if (!first) {
    return { intro: markdown, subsections: [] };
  }
  const subsections = headings.map((heading, i) => ({
    kind: KIND_BY_HEADING.get(heading.text.toLowerCase()) ?? "main",
    heading: heading.text,
    markdown: markdown.slice(heading.bodyStart, headings[i + 1]?.index ?? markdown.length),
  }));
  return { intro: markdown.slice(0, first.index), subsections };
}

interface HeadingMatch {
  /** Offset of the heading line. */
  index: number;
  /** Offset of the heading line's newline, so every body starts with it. */
  bodyStart: number;
  text: string;
}

/** Own-line `## ` headings with their character offsets, skipping fenced code blocks (the model
 * quotes markdown and diffs, and a `## ` line inside a quoted block must not split anything). */
function findHeadings(markdown: string): HeadingMatch[] {
  const headings: HeadingMatch[] = [];
  let offset = 0;
  let openFence: string | undefined;
  for (const rawLine of markdown.split("\n")) {
    // Matched without the `\r`, measured with it, so offsets stay right for CRLF input.
    const line = rawLine.replace(/\r$/, "");
    const fence = FENCE_PATTERN.exec(line)?.[1];
    if (openFence !== undefined) {
      if (fence?.startsWith(openFence)) {
        openFence = undefined;
      }
    } else if (fence) {
      openFence = fence;
    } else {
      const text = H2_PATTERN.exec(line)?.[1];
      if (text !== undefined) {
        const clean = cleanHeading(text);
        if (clean !== "") {
          headings.push({ index: offset, bodyStart: offset + rawLine.length, text: clean });
        }
      }
    }
    offset += rawLine.length + 1;
  }
  return headings;
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
