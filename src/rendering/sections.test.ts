import { describe, expect, it } from "vitest";
import { splitCategoryMarkdown } from "./sections.js";

describe("splitCategoryMarkdown", () => {
  it("splits every own-line ## heading into a subsection, in order", () => {
    const result = splitCategoryMarkdown(
      "## What changed\n\nMain body.\n\n## Tests\n\nTest body.\n\n## Documentation\n\nDoc body.\n",
    );
    expect(result.intro).toBe("");
    expect(result.subsections).toEqual([
      { kind: "main", heading: "What changed", markdown: "\n\nMain body.\n\n" },
      { kind: "test", heading: "Tests", markdown: "\n\nTest body.\n\n" },
      { kind: "docs", heading: "Documentation", markdown: "\n\nDoc body.\n" },
    ]);
  });

  it("recognizes test and docs headings by a short synonym list, ignoring case, a colon and closing #s", () => {
    const kinds = (markdown: string) =>
      splitCategoryMarkdown(markdown).subsections.map((s) => s.kind);
    expect(kinds("## tests\n## Test\n## Testing:\n## Test code\n")).toEqual([
      "test",
      "test",
      "test",
      "test",
    ]);
    expect(kinds("## Docs\n## documentation ##\n")).toEqual(["docs", "docs"]);
    expect(kinds("## Production code\n## Testing strategy\n")).toEqual(["main", "main"]);
    expect(splitCategoryMarkdown("## Tests: ##\n").subsections[0]?.heading).toBe("Tests");
  });

  it("treats a heading that is an Object.prototype name as a main section", () => {
    const result = splitCategoryMarkdown("## Constructor\n\nBody.\n");
    expect(result.subsections.map((s) => [s.kind, s.heading])).toEqual([["main", "Constructor"]]);
  });

  it("keeps a # that belongs to the heading's last word", () => {
    const headings = splitCategoryMarkdown(
      "## Migrating to C#\n## Why F#\n## Tests ##\n",
    ).subsections;
    expect(headings.map((s) => s.heading)).toEqual(["Migrating to C#", "Why F#", "Tests"]);
  });

  it("splits CRLF markdown at the right offsets", () => {
    const result = splitCategoryMarkdown("Intro.\r\n\r\n## Tests\r\n\r\nT\r\n");
    expect(result.intro).toBe("Intro.\r\n\r\n");
    // The heading line owns its `\r`; the body starts at the newline, as for LF input.
    expect(result.subsections).toEqual([
      { kind: "test", heading: "Tests", markdown: "\n\r\nT\r\n" },
    ]);
  });

  it("keeps text before the first heading as intro", () => {
    const result = splitCategoryMarkdown("Some lead-in.\n\n## What changed\n\nBody.\n");
    expect(result.intro).toBe("Some lead-in.\n\n");
    expect(result.subsections).toHaveLength(1);
  });

  it("treats markdown with no ## headings as intro-only", () => {
    const result = splitCategoryMarkdown("Just prose.\n\n### A deeper heading\n\n# Top\n");
    expect(result.intro).toBe("Just prose.\n\n### A deeper heading\n\n# Top\n");
    expect(result.subsections).toEqual([]);
  });

  it("ignores a ## line inside a fenced code block", () => {
    const result = splitCategoryMarkdown(
      "Intro.\n\n```markdown\n## Not a section\n```\n\n~~~\n## Nor this\n~~~\n\n## Tests\n\nT\n",
    );
    expect(result.subsections.map((s) => s.heading)).toEqual(["Tests"]);
    expect(result.intro).toContain("## Not a section");
    expect(result.intro).toContain("## Nor this");
  });

  // Blanked rather than removed: joining the neighbours would make "Intro" a setext heading.
  it.each(["## ###", "##", "## "])("blanks a %s line that names nothing, keeping the line", (h) => {
    const result = splitCategoryMarkdown(`Intro\n${h}\n---\n`);
    expect(result.subsections).toEqual([]);
    expect(result.intro).toBe("Intro\n\n---\n");
  });

  it("keeps the blanked line's \\r on CRLF input", () => {
    expect(splitCategoryMarkdown("Intro\r\n## ###\r\n---\r\n").intro).toBe("Intro\r\n\r\n---\r\n");
  });

  it("splits on a heading that immediately follows a closing fence", () => {
    const result = splitCategoryMarkdown("```\n## Quoted\n```\n## Tests\n\nT\n");
    expect(result.subsections.map((s) => s.heading)).toEqual(["Tests"]);
  });

  it("does not match a heading that isn't on its own line", () => {
    const result = splitCategoryMarkdown("Some text ## Tests more text\n");
    expect(result.subsections).toEqual([]);
  });
});
