// Regenerates a self-contained sample page for visual inspection of the rendering refinements
// in docs/adr/0007-rendering-refinements.md. No committed `gen-rich`-style script existed before
// this unit — this replaces the throwaway one-off used during review. Run via:
//
//   node scripts/copy-assets.mjs   # once, to populate src/rendering/assets/vendor/*
//   npx tsx scripts/gen-sample.ts  # prints file://<path>/index.html — open in a browser
//
// Deliberately small but representative: a labeled PR-description section, a category with
// both a "## Production code" and "## Test code" subsection (so a production unfold=yes
// snippet stays open while the test one folds), a modified code file with both an add and a
// remove row (gutter markers), and a modified markdown file with a long line (wraps instead of
// forcing horizontal scroll).
import { serializeSnippetRef } from "../src/explanations/markup.js";
import { assembleOutput } from "../src/rendering/assemble.js";
import { buildAlignedDiff } from "../src/rendering/line-diff.js";
import { renderPage } from "../src/rendering/template.js";

const codeRef = serializeSnippetRef({
  path: "src/parse.ts",
  side: "head",
  lines: { start: 1, end: 4 },
  unfold: true,
});
const testRef = serializeSnippetRef({
  path: "src/parse.test.ts",
  side: "head",
  lines: { start: 1, end: 2 },
  unfold: true, // forced collapsed anyway — it's inside a "## Test code" subsection
});
const docsRef = serializeSnippetRef({
  path: "docs/README.md",
  side: "head",
  lines: { start: 1, end: 1 },
  unfold: true,
});

const codeRows = buildAlignedDiff(
  "export function parse(input) {\n  return JSON.parse(input);\n}\n",
  'export function parse(input: string): unknown {\n  const trimmed = input.trim();\n  if (!trimmed) throw new Error("empty input");\n  return JSON.parse(trimmed);\n}\n',
);
const testRows = buildAlignedDiff(
  "test('parses', () => {\n  expect(parse('1')).toBe(1);\n});\n",
  "test('parses', () => {\n  expect(parse('1')).toBe(1);\n  expect(() => parse('')).toThrow();\n});\n",
);
const longLine =
  "This paragraph documents the new validation path in detail, covering the empty-input case, the malformed-JSON case, and how each is surfaced to the caller so reviewers reading this diff on a normal-width screen never have to scroll sideways to read a single sentence.\n";
const docsRows = buildAlignedDiff("# README\n\nParses input.\n", `# README\n\n${longLine}`);

const fileDiffs = new Map([
  ["src/parse.ts", { rows: codeRows, embeddable: true }],
  ["src/parse.test.ts", { rows: testRows, embeddable: true }],
  ["docs/README.md", { rows: docsRows, embeddable: true }],
]);

const markdown = `A short intro paragraph, followed by a list:\n\n- validates empty input\n- validates malformed JSON\n\n## Production code\n\n${codeRef}\n\n## Test code\n\n${testRef}\n\nDocs were also updated:\n\n${docsRef}\n`;

const html = renderPage({
  prTitle: "Add input validation to parse()",
  prDescription:
    "This PR adds validation to `parse()` so empty or malformed input fails fast with a clear error, instead of letting `JSON.parse` throw an opaque `SyntaxError` further down the call stack.",
  prUrl: "https://github.com/example/repo/pull/42",
  fileDiffs,
  explanations: [
    {
      category: { id: "c1", name: "Input validation", description: "Core parsing change." },
      markdown,
    },
  ],
});

const result = await assembleOutput(html);
console.log(`file://${result.indexPath}`);
