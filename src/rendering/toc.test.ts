import { describe, expect, it } from "vitest";
import { buildToc, renderTocHtml } from "./toc.js";

describe("buildToc", () => {
  it("always prepends the PR description as the first entry, ahead of every category", () => {
    const toc = buildToc([{ name: "Auth" }, { name: "Logging" }], [[], []]);
    expect(toc[0]).toEqual({ id: "pr-description", label: "PR description", children: [] });
    expect(toc.slice(1).map((entry) => entry.label)).toEqual(["Auth", "Logging"]);
  });

  it("prepends the PR description entry even with no categories", () => {
    const toc = buildToc([], []);
    expect(toc).toEqual([{ id: "pr-description", label: "PR description", children: [] }]);
  });
});

describe("renderTocHtml", () => {
  it("renders the PR description entry as a plain (childless) link first", () => {
    const toc = buildToc([{ name: "Auth" }], [[]]);
    const html = renderTocHtml(toc);
    const prDescriptionIndex = html.indexOf('href="#pr-description"');
    const authIndex = html.indexOf('href="#category-0"');
    expect(prDescriptionIndex).toBeGreaterThanOrEqual(0);
    expect(prDescriptionIndex).toBeLessThan(authIndex);
  });
});
