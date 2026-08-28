import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ASSETS_DIR = fileURLToPath(new URL("./assets", import.meta.url));

function readAsset(name: string): string {
  return readFileSync(`${ASSETS_DIR}/${name}`, "utf8");
}

// Structural/content checks on the bundled CSS/JS assets (layout, palette, highlighter wiring)
// that don't need a real browser to verify — see docs/adr/0004 for what these implement.
describe("style.css", () => {
  const css = readAsset("style.css");

  it("keeps prose elements narrow while letting diff/code blocks use the full width", () => {
    // Prose elements get their own centered measure...
    expect(css).toMatch(/--prose-measure:\s*\d/);
    expect(css).toMatch(
      /main\s+:is\([^)]*\bp\b[^)]*\)\s*\{[^}]*max-width:\s*var\(--prose-measure\)/,
    );
    // ...while `.snippet` (the diff block) is never given that narrow measure.
    const snippetRuleMatch = css.match(/\.snippet\s*\{[^}]*\}/);
    expect(snippetRuleMatch?.[0]).toBeDefined();
    expect(snippetRuleMatch?.[0]).not.toContain("--prose-measure");
  });

  it("gives code a smaller font size than prose", () => {
    expect(css).toMatch(/--code-font-size:\s*0\.\d+rem/);
    expect(css).toMatch(/body\s*\{[^}]*font-size:\s*16px/);
  });

  it("only lets diff/code containers scroll horizontally, never the page", () => {
    expect(css).toMatch(/\.snippet-scroll\s*\{[^}]*overflow-x:\s*auto/);
    expect(css).not.toMatch(/\bbody\s*\{[^}]*overflow-x:\s*auto/);
  });

  it("defines a full palette for both light and dark themes", () => {
    for (const variable of ["--bg", "--fg", "--link", "--accent", "--add-fg", "--remove-fg"]) {
      // Once in :root (light), and again in both the prefers-color-scheme and [data-theme="dark"]
      // dark blocks.
      const occurrences = css.split(variable).length - 1;
      expect(
        occurrences,
        `${variable} should be defined for light and dark`,
      ).toBeGreaterThanOrEqual(3);
    }
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain(':root[data-theme="dark"]');
  });

  it("defines a highlight.js theme keyed off the page's own palette", () => {
    for (const cls of [".hljs-keyword", ".hljs-string", ".hljs-comment", ".hljs-title"]) {
      expect(css).toContain(cls);
    }
    // Themed with this page's CSS variables, not hardcoded hex colors copied from a bundled
    // highlight.js theme.
    const hljsSection = css.slice(css.indexOf(".hljs {"));
    expect(hljsSection).toMatch(/var\(--/);
  });

  it("keeps syntax-token colors independent of the diff +/- colors", () => {
    // Token colors render inside diff cells too — reusing --add-fg/--remove-fg there both
    // failed measured contrast on the opposite-polarity background and read as a false
    // add/remove signal (e.g. a green string token on a removed/red line).
    const hljsSection = css.slice(css.indexOf(".hljs {"));
    expect(hljsSection).not.toMatch(/color:\s*var\(--add-fg\)/);
    expect(hljsSection).not.toMatch(/color:\s*var\(--remove-fg\)/);
    expect(hljsSection).toMatch(/color:\s*var\(--token-string\)/);
    expect(hljsSection).toMatch(/color:\s*var\(--token-attr\)/);
    for (const variable of ["--token-string", "--token-attr"]) {
      const occurrences = css.split(variable).length - 1;
      // Defined for light and dark, plus at least one use.
      expect(
        occurrences,
        `${variable} should be defined for light and dark`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("styles GFM tables and constrains prose images", () => {
    expect(css).toMatch(/main table:not\(\.snippet-table\)[^{]*\{[^}]*border-collapse/);
    expect(css).toMatch(/main img\s*\{[^}]*max-width:\s*100%/);
  });

  it("completes the heading scale and gives blockquote a visual identity", () => {
    expect(css).toMatch(/h4\s*\{[^}]*font-size/);
    expect(css).toMatch(/blockquote\s*\{[^}]*border-left/);
  });

  it("references no external network resources", () => {
    expect(css).not.toMatch(/https?:\/\//);
    expect(css).not.toMatch(/@import/);
    expect(css).not.toContain("cdn.");
  });
});

describe("app.js", () => {
  const js = readAsset("app.js");

  it("wires up highlight.js via its safe, escaping element API", () => {
    expect(js).toContain("window.hljs.highlightElement");
    // Never hand raw/untrusted text to innerHTML directly — highlight.js's own safe API does
    // that internally, from the element's already-escaped textContent.
    expect(js).not.toMatch(/\.innerHTML\s*=\s*(?!"")[a-zA-Z_]/);
  });

  it("re-highlights newly-inserted rows after context expansion", () => {
    const start = js.indexOf("function setupSnippetExpansion");
    const end = js.indexOf("\n  function ", start + 1);
    expect(js.slice(start, end)).toContain("highlightSnippetContainer");
  });

  it("guesses the diff language from data-lang and skips unknown languages", () => {
    expect(js).toContain('container.getAttribute("data-lang")');
    expect(js).toContain("window.hljs.getLanguage(lang)");
  });

  it("skips highlighting a pathologically large code cell", () => {
    expect(js).toMatch(/MAX_HIGHLIGHT_CHARS\s*=\s*\d+/);
    expect(js).toMatch(/textContent\.length\s*>\s*MAX_HIGHLIGHT_CHARS/);
  });

  it("references no external network resources", () => {
    expect(js).not.toMatch(/https?:\/\//);
  });
});
