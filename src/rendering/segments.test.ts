import { describe, expect, it } from "vitest";
import { renderWithSegments } from "./segments.js";

describe("renderWithSegments", () => {
  it("renders prose around a segment through markdown, and the segment via its own renderer", () => {
    const markdown = "Before **bold**.\n\nSPECIAL\n\nAfter *em*.";
    const start = markdown.indexOf("SPECIAL");
    const end = start + "SPECIAL".length;
    const html = renderWithSegments(markdown, [
      { start, end, render: () => "<div class='special'>X</div>" },
    ]);
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<div class='special'>X</div>");
    expect(html).toContain("<em>em</em>");
  });

  it("renders multiple segments in position order regardless of input order", () => {
    const markdown = "AAA\n\nBBB\n\n";
    const a = {
      start: markdown.indexOf("AAA"),
      end: markdown.indexOf("AAA") + 3,
      render: () => "[A]",
    };
    const b = {
      start: markdown.indexOf("BBB"),
      end: markdown.indexOf("BBB") + 3,
      render: () => "[B]",
    };
    const html = renderWithSegments(markdown, [b, a]);
    expect(html.indexOf("[A]")).toBeLessThan(html.indexOf("[B]"));
  });

  it("drops an overlapping segment rather than mangling output", () => {
    const markdown = "0123456789";
    const first = { start: 0, end: 5, render: () => "[FIRST]" };
    const overlapping = { start: 2, end: 8, render: () => "[OVERLAP]" };
    const html = renderWithSegments(markdown, [first, overlapping]);
    expect(html).toContain("[FIRST]");
    expect(html).not.toContain("[OVERLAP]");
  });

  it("renders plain prose when there are no segments", () => {
    const html = renderWithSegments("Just *text*.", []);
    expect(html).toBe("<p>Just <em>text</em>.</p>\n");
  });
});
