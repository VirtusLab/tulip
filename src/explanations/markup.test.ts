import { describe, expect, it } from "vitest";
import { parseSnippetRefs, type SnippetRef, serializeSnippetRef } from "./markup.js";

const MODIFICATION: SnippetRef = {
  path: "src/fetch.ts",
  base: { start: 8, end: 9 },
  head: { start: 10, end: 14 },
  unfold: true,
};

describe("serializeSnippetRef / parseSnippetRefs", () => {
  it("round-trips a modification (both sides) through serialize then parse", () => {
    const markup = serializeSnippetRef(MODIFICATION);
    expect(markup).toBe('{{snippet path="src/fetch.ts" base="8-9" head="10-14" unfold="yes"}}');

    const matches = parseSnippetRefs(markup);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.ref).toEqual(MODIFICATION);
    expect(matches[0]?.start).toBe(0);
    expect(matches[0]?.end).toBe(markup.length);
  });

  it("serializes and parses a head-only ref (an addition), omitting the absent base", () => {
    const ref: SnippetRef = { path: "src/a.ts", head: { start: 1, end: 3 }, unfold: true };
    const markup = serializeSnippetRef(ref);
    expect(markup).toBe('{{snippet path="src/a.ts" head="1-3" unfold="yes"}}');
    expect(parseSnippetRefs(markup)[0]?.ref).toEqual(ref);
  });

  it("serializes and parses a base-only ref (a deletion), omitting the absent head", () => {
    const ref: SnippetRef = { path: "src/a.ts", base: { start: 1, end: 3 }, unfold: false };
    const markup = serializeSnippetRef(ref);
    expect(markup).toBe('{{snippet path="src/a.ts" base="1-3" unfold="no"}}');
    expect(parseSnippetRefs(markup)[0]?.ref).toEqual(ref);
  });

  it("parses tolerantly regardless of attribute order", () => {
    const markup = '{{snippet head="10-14" unfold="yes" path="src/fetch.ts" base="8-9"}}';
    expect(parseSnippetRefs(markup)[0]?.ref).toEqual(MODIFICATION);
  });

  it("extracts multiple refs embedded in surrounding markdown, with correct positions", () => {
    const first = serializeSnippetRef(MODIFICATION);
    const second = serializeSnippetRef({
      path: "src/fetch.test.ts",
      base: { start: 1, end: 3 },
      unfold: false,
    });
    const markdown = `# Explanation\n\nSome prose.\n\n${first}\n\nMore prose.\n\n${second}\n`;

    const matches = parseSnippetRefs(markdown);

    expect(matches).toHaveLength(2);
    expect(markdown.slice(matches[0]?.start, matches[0]?.end)).toBe(first);
    expect(markdown.slice(matches[1]?.start, matches[1]?.end)).toBe(second);
    expect(matches[1]?.ref.path).toBe("src/fetch.test.ts");
  });

  it("leaves a tag with neither base nor head in place (returns nothing)", () => {
    const markdown = '{{snippet path="a.ts" unfold="yes"}}';
    expect(parseSnippetRefs(markdown)).toEqual([]);
  });

  it("leaves a tag with a malformed head range in place", () => {
    const markdown = '{{snippet path="a.ts" head="one-two" unfold="yes"}}';
    expect(parseSnippetRefs(markdown)).toEqual([]);
  });

  it("leaves a tag with a backwards base range in place", () => {
    const markdown = '{{snippet path="a.ts" base="10-5" unfold="yes"}}';
    expect(parseSnippetRefs(markdown)).toEqual([]);
  });

  it("leaves a tag with an invalid unfold value in place", () => {
    const markdown = '{{snippet path="a.ts" head="1-2" unfold="maybe"}}';
    expect(parseSnippetRefs(markdown)).toEqual([]);
  });

  it("ignores a tag that isn't alone on its own line", () => {
    const markdown = `See this: ${serializeSnippetRef(MODIFICATION)} for details.`;
    expect(parseSnippetRefs(markdown)).toEqual([]);
  });

  it("returns an empty array for markdown with no snippet refs", () => {
    expect(parseSnippetRefs("Just some prose, no refs here.")).toEqual([]);
  });
});
