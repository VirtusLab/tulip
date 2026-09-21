import { describe, expect, it } from "vitest";
import { buildToc, renderTocHtml } from "./toc.js";

describe("buildToc", () => {
  it("always prepends the PR description as the first entry, ahead of every category", () => {
    const toc = buildToc(
      [
        { name: "Auth", attention: "close" },
        { name: "Logging", attention: "skim" },
      ],
      [[], []],
    );
    expect(toc[0]).toEqual({
      id: "pr-description",
      label: "Original PR description",
      children: [],
    });
    expect(toc.slice(1).map((entry) => entry.label)).toEqual(["Auth", "Logging"]);
  });

  it("prepends the PR description entry even with no categories", () => {
    const toc = buildToc([], []);
    expect(toc).toEqual([{ id: "pr-description", label: "Original PR description", children: [] }]);
  });

  it("carries each category's attention onto its entry, but not onto the PR-description entry", () => {
    const toc = buildToc([{ name: "Auth", attention: "close" }], [[]]);
    expect(toc[0]?.attention).toBeUndefined();
    expect(toc[1]?.attention).toBe("close");
  });
});

describe("renderTocHtml", () => {
  it("renders the PR description entry as a plain (childless) link first", () => {
    const toc = buildToc([{ name: "Auth", attention: "close" }], [[]]);
    const html = renderTocHtml(toc);
    const prDescriptionIndex = html.indexOf('href="#pr-description"');
    const authIndex = html.indexOf('href="#category-0"');
    expect(prDescriptionIndex).toBeGreaterThanOrEqual(0);
    expect(prDescriptionIndex).toBeLessThan(authIndex);
  });

  it("renders a category's attention badge inline before its label, with the right weight class", () => {
    const toc = buildToc(
      [
        { name: "Auth", attention: "close" },
        { name: "Wiring", attention: "skim" },
      ],
      [[], []],
    );
    const html = renderTocHtml(toc);
    expect(html).toContain('<span class="attention-badge attention-close">Read closely</span>Auth');
    expect(html).toContain('<span class="attention-badge attention-skim">Skim</span>Wiring');
  });

  it("renders no attention badge for the PR-description entry", () => {
    const toc = buildToc([{ name: "Auth", attention: "close" }], [[]]);
    const html = renderTocHtml(toc);
    const prDescriptionLi = html.slice(0, html.indexOf("</li>") + 5);
    expect(prDescriptionLi).not.toContain("attention-badge");
  });

  it("renders no attention badge for subsection children", () => {
    const toc = buildToc(
      [{ name: "Auth", attention: "close" }],
      [[{ id: "category-0-main-0", heading: "What changed" }]],
    );
    const html = renderTocHtml(toc);
    expect(html).toContain("toc-children");
    const childrenHtml = html.slice(html.indexOf("toc-children"));
    expect(childrenHtml).not.toContain("attention-badge");
  });
});

describe("buildToc — subsection children", () => {
  it("passes each subsection's precomputed id and heading through as the child's id and label", () => {
    const toc = buildToc(
      [{ name: "Auth", attention: "close" }],
      [
        [
          { id: "category-0-main-0", heading: "Why key by the stage" },
          { id: "category-0-test-1", heading: "Tests" },
          { id: "category-0-docs-2", heading: "Docs" },
        ],
      ],
    );
    expect(toc[1]?.children.map((child) => [child.id, child.label])).toEqual([
      ["category-0-main-0", "Why key by the stage"],
      ["category-0-test-1", "Tests"],
      ["category-0-docs-2", "Docs"],
    ]);
  });
});
