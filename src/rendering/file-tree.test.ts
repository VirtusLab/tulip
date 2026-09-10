import { describe, expect, it } from "vitest";
import { buildFileTree, renderFileTree } from "./file-tree.js";

const prod = (path: string) => ({ path, isTest: false });
const test = (path: string) => ({ path, isTest: true });

describe("buildFileTree", () => {
  it("collapses a single-child directory chain into one file leaf", () => {
    expect(buildFileTree([prod("docs/adr/0018-one.md")])).toEqual([
      { label: "docs/adr/0018-one.md", isFile: true, isTest: false, children: [] },
    ]);
  });

  it("keeps a branch directory split but collapses its single-child subtrees", () => {
    const tree = buildFileTree([
      prod("src/rendering/sections.ts"),
      prod("src/rendering/template.ts"),
      prod("src/diff/change.ts"),
    ]);
    expect(tree).toEqual([
      {
        label: "src",
        isFile: false,
        isTest: false,
        children: [
          {
            label: "rendering",
            isFile: false,
            isTest: false,
            children: [
              { label: "sections.ts", isFile: true, isTest: false, children: [] },
              { label: "template.ts", isFile: true, isTest: false, children: [] },
            ],
          },
          { label: "diff/change.ts", isFile: true, isTest: false, children: [] },
        ],
      },
    ]);
  });

  it("orders branch directories before files, alphabetically within each group", () => {
    const tree = buildFileTree([
      prod("z.ts"),
      prod("a.ts"),
      prod("lib/one.ts"),
      prod("lib/two.ts"),
    ]);
    expect(tree.map((n) => n.label)).toEqual(["lib", "a.ts", "z.ts"]);
  });

  it("marks a test-only file and leaves a production file unmarked", () => {
    const tree = buildFileTree([prod("src/a.ts"), test("src/a.test.ts")]);
    const names = (tree[0]?.children ?? []).map((n) => [n.label, n.isTest]);
    expect(names).toEqual([
      ["a.test.ts", true],
      ["a.ts", false],
    ]);
  });

  it("returns an empty forest for no files", () => {
    expect(buildFileTree([])).toEqual([]);
  });
});

describe("renderFileTree", () => {
  it("renders nested lists with dir and file classes and a test tag", () => {
    const html = renderFileTree([prod("src/a.ts"), test("src/a.test.ts")]);
    expect(html).toContain('<aside class="file-tree-box"');
    expect(html).toContain('<p class="file-tree-title">Relevant files</p>');
    expect(html).toContain('<ul class="file-tree">');
    expect(html).toContain('<li class="dir">src<ul>');
    expect(html).toContain('<li class="file">a.ts</li>');
    expect(html).toContain('<li class="file">a.test.ts<span class="file-tag">test</span></li>');
  });

  it("escapes path segments", () => {
    expect(renderFileTree([prod("a<b>.ts")])).toContain("a&lt;b&gt;.ts");
  });

  it("returns an empty string for no files", () => {
    expect(renderFileTree([])).toBe("");
  });
});
