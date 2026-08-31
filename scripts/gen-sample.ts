// Regenerates a self-contained sample page for visual inspection of the rendering refinements
// in docs/adr/0007-rendering-refinements.md and docs/adr/0009-rendering-fixes-batch-2.md. No
// committed `gen-rich`-style script existed before unit 6 — this replaces the throwaway one-off
// used during review. Run via:
//
//   node scripts/copy-assets.mjs   # once, to populate src/rendering/assets/vendor/*
//   npx tsx scripts/gen-sample.ts  # prints file://<path>/index.html — open in a browser
//
// Deliberately small but representative: a labeled PR-description section, a category with
// both a "## Production code" and "## Test code" subsection (so a production unfold=yes
// snippet stays open while the test one folds), a modified code file with both an add and a
// remove row (gutter markers), a modified markdown file with a long line (wraps instead of
// forcing horizontal scroll), a small mermaid diagram (should center, not sit flush left), and
// an added + a deleted file (each a single pane, not a two-pane split with one side blank).
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
const addedRef = serializeSnippetRef({
  path: "docs/json.md",
  side: "head",
  lines: { start: 1, end: 3 },
  unfold: true,
});
const removedRef = serializeSnippetRef({
  path: "src/legacy.ts",
  side: "base",
  lines: { start: 1, end: 3 },
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
const addedRows = buildAlignedDiff(
  "",
  "# JSON format\n\nDocuments the on-disk JSON schema this parser accepts.\n",
);
const removedRows = buildAlignedDiff(
  "export function legacyParse(input) {\n  return eval(input);\n}\n",
  "",
);

const prDescriptionRef = serializeSnippetRef({
  path: "src/parse.ts",
  side: "head",
  lines: { start: 1, end: 2 },
  unfold: true,
});

const fileDiffs = new Map([
  ["src/parse.ts", { rows: codeRows, embeddable: true, status: "modified" as const }],
  ["src/parse.test.ts", { rows: testRows, embeddable: true, status: "modified" as const }],
  ["docs/README.md", { rows: docsRows, embeddable: true, status: "modified" as const }],
  ["docs/json.md", { rows: addedRows, embeddable: true, status: "added" as const }],
  ["src/legacy.ts", { rows: removedRows, embeddable: true, status: "removed" as const }],
]);

const diagram =
  "```mermaid\nflowchart LR\n  A[input] --> B{valid?}\n  B -->|yes| C[parsed]\n  B -->|no| D[Error]\n```";

const markdown = `A short intro paragraph, followed by a list:\n\n- validates empty input\n- validates malformed JSON\n\n${diagram}\n\n## Production code\n\n${codeRef}\n\nA new doc file was added (single pane, all additions):\n\n${addedRef}\n\nA legacy helper was deleted (single pane, all removals):\n\n${removedRef}\n\n## Test code\n\n${testRef}\n\nDocs were also updated:\n\n${docsRef}\n`;

// The PR description also exercises: a blockquote (left-edge alignment), and a snippet (full-
// width breakout must reach it too — it renders as a direct section child, not nested in a
// wrapper div; see docs/adr/0007's amendment).
const prDescription = `This PR adds validation to \`parse()\` so empty or malformed input fails fast with a clear error, instead of letting \`JSON.parse\` throw an opaque \`SyntaxError\` further down the call stack.\n\n> Follow-up to the incident where a malformed webhook payload crashed the ingest worker.\n\n${prDescriptionRef}\n`;

const html = renderPage({
  prTitle: "Add input validation to parse()",
  prDescription,
  prUrl: "https://github.com/example/repo/pull/42",
  fileDiffs,
  explanations: [
    // Exercises all three attention badges (docs/adr/0010). renderPage renders sections in the
    // given array order — the code that derives order from attention rank
    // (assignCategoryIds, src/categories/types.ts) runs earlier, at category-generation time —
    // so this sample lists them already in presentation order: close, then normal, then skim.
    {
      category: {
        id: "c1",
        name: "Input validation",
        description: "Core parsing change.",
        attention: "close",
      },
      markdown,
    },
    {
      category: {
        id: "c2",
        name: "Test coverage",
        description: "Adds a test for the empty-input case.",
        attention: "normal",
      },
      markdown: `## Test code\n\n${testRef}\n`,
    },
    {
      category: {
        id: "c3",
        name: "Docs wording",
        description: "Tightens a sentence in the README.",
        attention: "skim",
      },
      markdown: `Minor doc wording tweak.\n\n${docsRef}\n`,
    },
  ],
});

const result = await assembleOutput(html);
console.log(`file://${result.indexPath}`);
