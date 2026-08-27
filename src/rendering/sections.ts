/** The two subsection headings an explanation's markdown may use (see src/explanations — the
 * explaining prompt asks for "## Production code" / "## Test code" headings, but doesn't
 * enforce them structurally, so a category's markdown may have neither, either, or both). */
export type SubsectionKind = "production" | "test";

export interface CategorySubsection {
  kind: SubsectionKind;
  /** Original heading text, e.g. "Production code". */
  heading: string;
  /** Markdown body between this heading and the next recognized heading (or end of string),
   * with the heading line itself stripped. */
  markdown: string;
}

/** One category's markdown, split into its recognized subsections plus any leading text. */
export interface CategorySections {
  /** Markdown appearing before the first recognized subsection heading. Usually empty, since
   * the explaining prompt asks for the whole explanation to be organized under the two
   * headings, but nothing enforces that structurally. */
  intro: string;
  subsections: CategorySubsection[];
}

const SUBSECTION_HEADING_PATTERN = /^##[ \t]+(Production code|Test code)[ \t]*$/gim;

const KIND_BY_HEADING: Record<string, SubsectionKind> = {
  "production code": "production",
  "test code": "test",
};

/**
 * Splits a category's explanation markdown into Production/Test subsections "as present in the
 * markdown" (spec: subsections are rendered only when the model actually produced the matching
 * heading — never forced). Recognizes only the exact, own-line "## Production code" / "## Test
 * code" headings (case-insensitive); anything else is left inside `intro` untouched.
 */
export function splitCategoryMarkdown(markdown: string): CategorySections {
  const headings = [...markdown.matchAll(SUBSECTION_HEADING_PATTERN)];

  if (headings.length === 0) {
    return { intro: markdown, subsections: [] };
  }

  const firstHeading = headings[0];
  if (firstHeading?.index === undefined) {
    return { intro: markdown, subsections: [] };
  }
  const intro = markdown.slice(0, firstHeading.index);

  const subsections: CategorySubsection[] = [];
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    if (heading?.index === undefined) {
      continue;
    }
    const headingText = heading[1] ?? "";
    const bodyStart = heading.index + heading[0].length;
    const nextHeading = headings[i + 1];
    const bodyEnd = nextHeading?.index ?? markdown.length;
    subsections.push({
      kind: KIND_BY_HEADING[headingText.toLowerCase()] ?? "production",
      heading: headingText,
      markdown: markdown.slice(bodyStart, bodyEnd),
    });
  }

  return { intro, subsections };
}
