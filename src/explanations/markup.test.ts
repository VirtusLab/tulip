import { describe, expect, it } from "vitest";
import { parseSnippetRefs, type SnippetRef, serializeSnippetRef } from "./markup.js";

const REF: SnippetRef = {
  path: "src/fetch.ts",
  side: "head",
  lines: { start: 10, end: 14 },
  unfold: true,
};

describe("serializeSnippetRef / parseSnippetRefs", () => {
  it("round-trips a single ref through serialize then parse", () => {
    const markup = serializeSnippetRef(REF);
    expect(markup).toBe('{{snippet path="src/fetch.ts" side="head" lines="10-14" unfold="yes"}}');

    const matches = parseSnippetRefs(markup);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.ref).toEqual(REF);
    expect(matches[0]?.start).toBe(0);
    expect(matches[0]?.end).toBe(markup.length);
  });

  it('serializes unfold: false as unfold="no"', () => {
    const markup = serializeSnippetRef({ ...REF, unfold: false });
    expect(markup).toContain('unfold="no"');
    expect(parseSnippetRefs(markup)[0]?.ref.unfold).toBe(false);
  });

  it("extracts multiple refs embedded in surrounding markdown, with correct positions", () => {
    const first = serializeSnippetRef(REF);
    const second = serializeSnippetRef({
      path: "src/fetch.test.ts",
      side: "base",
      lines: { start: 1, end: 3 },
      unfold: false,
    });
    const markdown = `# Explanation\n\nSome prose.\n\n${first}\n\nMore prose.\n\n${second}\n`;

    const matches = parseSnippetRefs(markdown);

    expect(matches).toHaveLength(2);
    expect(markdown.slice(matches[0]?.start, matches[0]?.end)).toBe(first);
    expect(markdown.slice(matches[1]?.start, matches[1]?.end)).toBe(second);
    expect(matches[1]?.ref.path).toBe("src/fetch.test.ts");
  });

  it("ignores a tag with an invalid side value", () => {
    const markdown = '{{snippet path="a.ts" side="front" lines="1-2" unfold="yes"}}';
    expect(parseSnippetRefs(markdown)).toEqual([]);
  });

  it("ignores a tag with a non-numeric line range", () => {
    const markdown = '{{snippet path="a.ts" side="head" lines="one-two" unfold="yes"}}';
    expect(parseSnippetRefs(markdown)).toEqual([]);
  });

  it("ignores a tag with a backwards line range", () => {
    const markdown = '{{snippet path="a.ts" side="head" lines="10-5" unfold="yes"}}';
    expect(parseSnippetRefs(markdown)).toEqual([]);
  });

  it("ignores a tag with an invalid unfold value", () => {
    const markdown = '{{snippet path="a.ts" side="head" lines="1-2" unfold="maybe"}}';
    expect(parseSnippetRefs(markdown)).toEqual([]);
  });

  it("ignores a tag that isn't alone on its own line", () => {
    const markdown = `See this: ${serializeSnippetRef(REF)} for details.`;
    expect(parseSnippetRefs(markdown)).toEqual([]);
  });

  it("returns an empty array for markdown with no snippet refs", () => {
    expect(parseSnippetRefs("Just some prose, no refs here.")).toEqual([]);
  });
});
