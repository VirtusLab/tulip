/** How a subsection renders (docs/adr/0022): `main` open, `test` and `docs` folded by default. The
 * kind comes from the heading text; the explaining prompt asks for `## Tests` and
 * `## Documentation` and lets the model name its main sections. */
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
   * this is the normal case, not an exception. Rendered open and unlabelled. */
  intro: string;
  subsections: CategorySubsection[];
}

const HEADING_PATTERN = /^##[ \t]+(.+?)[ \t]*$/;
const FENCE_PATTERN = /^[ \t]{0,3}(`{3,}|~{3,})/;

const KIND_BY_HEADING: Record<string, SubsectionKind> = {
  tests: "test",
  test: "test",
  testing: "test",
  "test code": "test",
  documentation: "docs",
  docs: "docs",
};

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
  const subsections = headings.map((heading, i) => {
    const bodyStart = heading.index + heading.length;
    const bodyEnd = headings[i + 1]?.index ?? markdown.length;
    return {
      kind: KIND_BY_HEADING[heading.text.toLowerCase()] ?? "main",
      heading: heading.text,
      markdown: markdown.slice(bodyStart, bodyEnd),
    };
  });
  return { intro: markdown.slice(0, first.index), subsections };
}

interface HeadingMatch {
  index: number;
  length: number;
  text: string;
}

/** Own-line `## ` headings with their character offsets, skipping fenced code blocks (the model
 * quotes markdown and diffs, and a `## ` line inside a quoted block must not split anything).
 * A fence closes on a line of the same character at least as long as the opener. */
function findHeadings(markdown: string): HeadingMatch[] {
  const headings: HeadingMatch[] = [];
  let offset = 0;
  let openFence: string | undefined;
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const fence = FENCE_PATTERN.exec(line)?.[1];
    if (fence && openFence === undefined) {
      openFence = fence;
    } else if (
      fence &&
      openFence !== undefined &&
      fence[0] === openFence[0] &&
      fence.length >= openFence.length
    ) {
      openFence = undefined;
    } else if (openFence === undefined) {
      const text = HEADING_PATTERN.exec(line)?.[1];
      if (text !== undefined) {
        headings.push({ index: offset, length: rawLine.length, text: cleanHeading(text) });
      }
    }
    offset += rawLine.length + 1;
  }
  return headings;
}

function cleanHeading(text: string): string {
  return text
    .replace(/[ \t]*#+$/, "")
    .replace(/:$/, "")
    .trim();
}
