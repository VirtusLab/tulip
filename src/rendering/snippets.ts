import type { SnippetRef } from "../explanations/markup.js";
import { escapeHtml } from "./escape.js";
import type { FileDiffData } from "./file-diffs.js";
import { isProseLanguage, languageForPath } from "./language.js";
import type { AlignedRow } from "./line-diff.js";

/**
 * Renders one `{{snippet}}` marker as a github-style split diff block (task 7.3): a collapsible
 * `<details>` — open when `ref.unfold` (and not `forceCollapsed`), otherwise collapsed behind a
 * "N lines — click to expand" summary — containing the referenced range's rows, with
 * expand-up/down buttons when `data.embeddable` (see ./assets/app.js for the client-side
 * expansion). Falls back to a plain notice if the file has no diff data (not in `fileDiffs`) or
 * the range isn't found in it — both should be rare (an LLM-hallucinated path/range), never a
 * crash.
 *
 * `forceCollapsed` overrides `ref.unfold` to always-collapsed — set by ./markdown.ts for a
 * "## Test code" subsection (see ./sections.ts), so test snippets default folded regardless of
 * their own unfold flag.
 */
export function renderSnippetBlock(
  ref: SnippetRef,
  fileDiffs: Map<string, FileDiffData>,
  forceCollapsed = false,
): string {
  const data = fileDiffs.get(ref.path);
  if (!data) {
    return renderFallback(ref, `${escapeHtml(ref.path)} could not be loaded.`);
  }

  const range = findRowRange(data.rows, ref.side, ref.lines);
  if (!range) {
    return renderFallback(ref, "The referenced lines could not be located in the diff.");
  }

  const lineCount = ref.lines.end - ref.lines.start + 1;
  const summary = `${escapeHtml(ref.path)} — ${ref.side} lines ${ref.lines.start}-${ref.lines.end} (${lineCount} line${lineCount === 1 ? "" : "s"})`;

  const canExpandUp = data.embeddable && range.first > 0;
  const canExpandDown = data.embeddable && range.last < data.rows.length - 1;

  const rowsHtml = data.rows
    .slice(range.first, range.last + 1)
    .map(renderSnippetRow)
    .join("");

  // Language is guessed from the path only (a small, fixed lookup table — see ./language.ts),
  // never from file content, so it can't be steered by attacker-controlled text. It rides on
  // the container rather than each `<code>` cell so the client (./assets/app.js) can add the
  // `language-<lang>` class and call highlight.js's `highlightElement` on already-escaped text
  // without needing to touch ./renderSnippetRow (and its byte-identical app.js mirror) at all.
  const lang = languageForPath(ref.path);
  const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : "";

  // Prose/doc files (markdown, or no recognized code language) wrap long lines instead of
  // scrolling horizontally — code files keep the scrolling behavior, where alignment matters
  // (see style.css's `.snippet-wrap`).
  const scrollClass = isProseLanguage(lang) ? "snippet-scroll snippet-wrap" : "snippet-scroll";

  const open = ref.unfold && !forceCollapsed;

  return `<div class="snippet" data-path="${escapeHtml(ref.path)}" data-start-index="${range.first}" data-end-index="${range.last}"${langAttr}>
<details${open ? " open" : ""}>
<summary>${summary}</summary>
${canExpandUp ? '<button type="button" class="snippet-expand" data-dir="up">↑ expand context</button>' : ""}
<div class="${scrollClass}">
<table class="snippet-table"><tbody>
${rowsHtml}
</tbody></table>
</div>
${canExpandDown ? '<button type="button" class="snippet-expand" data-dir="down">↓ expand context</button>' : ""}
</details>
</div>`;
}

function renderFallback(ref: SnippetRef, message: string): string {
  return `<div class="snippet snippet-unavailable">${message} (${escapeHtml(ref.path)}, ${ref.side} lines ${ref.lines.start}-${ref.lines.end})</div>`;
}

/**
 * Renders one diff row as a `<tr>`. Mirrored line-for-line in ./assets/app.js's own
 * `renderSnippetRow` (client-side context expansion inserts more rows without a server
 * round-trip — see setupSnippetExpansion there) — the two must stay byte-identical; keep them
 * in sync by hand and see snippets.test.ts's "byte-identical" parity test, which evaluates
 * app.js's copy in Node and asserts it matches this one on the same input.
 *
 * Each side also gets a narrow marker cell ("-"/"+"/blank) alongside the existing
 * background-color class (`cellTypeClass`) — an explicit add/remove signal that doesn't rely on
 * color alone (task: diffs are easy to miss with color-only distinction).
 */
export function renderSnippetRow(row: AlignedRow): string {
  return (
    "<tr>" +
    `<td class="snippet-line-no side-base${cellTypeClass(row.baseType)}">${row.baseLine ?? ""}</td>` +
    `<td class="snippet-marker side-base${cellTypeClass(row.baseType)}">${row.baseType === "remove" ? "-" : ""}</td>` +
    `<td class="snippet-cell-base${cellTypeClass(row.baseType)}"><code>${row.baseText !== null ? escapeHtml(row.baseText) : ""}</code></td>` +
    `<td class="snippet-line-no side-head${cellTypeClass(row.headType)}">${row.headLine ?? ""}</td>` +
    `<td class="snippet-marker side-head${cellTypeClass(row.headType)}">${row.headType === "add" ? "+" : ""}</td>` +
    `<td class="snippet-cell-head${cellTypeClass(row.headType)}"><code>${row.headText !== null ? escapeHtml(row.headText) : ""}</code></td>` +
    "</tr>"
  );
}

function cellTypeClass(type: AlignedRow["baseType"]): string {
  return type ? ` type-${type}` : "";
}

/** Finds the contiguous run of row indices whose `side` line number falls within `lines`. */
function findRowRange(
  rows: AlignedRow[],
  side: SnippetRef["side"],
  lines: SnippetRef["lines"],
): { first: number; last: number } | undefined {
  let first = -1;
  let last = -1;
  for (let i = 0; i < rows.length; i++) {
    const lineNo = side === "base" ? rows[i]?.baseLine : rows[i]?.headLine;
    if (lineNo === null || lineNo === undefined) {
      continue;
    }
    if (lineNo >= lines.start && lineNo <= lines.end) {
      if (first === -1) {
        first = i;
      }
      last = i;
    }
  }
  return first === -1 ? undefined : { first, last };
}
