import type { LineRange } from "../diff/change.js";
import type { SnippetRef } from "../explanations/markup.js";
import { escapeHtml } from "./escape.js";
import type { FileDiffData } from "./file-diffs.js";
import { isProseLanguage, languageForPath } from "./language.js";
import { type AlignedRow, buildRegionDiff } from "./line-diff.js";

/**
 * Which side(s) of a diff row {@link renderSnippetRow} draws: `"split"` renders both base and head
 * cells, github split-diff style. `"head-only"`/`"base-only"` render just one side's three cells —
 * used for a snippet reference that has only that side (an addition or a deletion, docs/adr/0018),
 * so a two-pane split would always leave one pane blank.
 */
export type SnippetPaneMode = "split" | "head-only" | "base-only";

/** The pane mode a reference's present sides call for (docs/adr/0018): both sides → the two-pane
 * split; a head-only reference (an addition) → head-only; a base-only reference (a deletion) →
 * base-only. Pane layout follows the reference, not the file's status — so a pure add/del inside a
 * modified file renders single-pane. */
function paneModeForRef(ref: SnippetRef): SnippetPaneMode {
  if (ref.base && ref.head) {
    return "split";
  }
  return ref.head ? "head-only" : "base-only";
}

/**
 * Renders one `{{snippet}}` marker as a diff block (task 7.3): a collapsible `<details>` — open
 * when `ref.unfold` (and not `forceCollapsed`), otherwise collapsed behind a "N lines — click to
 * expand" summary. The reference's own base and/or head lines are aligned into a fresh
 * per-region mini-diff (docs/adr/0018), so one change renders as exactly one correctly-paired
 * diff: a modification shows both panes, an addition head-only, a deletion base-only, and two
 * adjacent split pieces of one change never overlap. Expand-up/down buttons appear when
 * `data.embeddable` and unhidden context exists on that edge (see ./assets/app.js for the
 * client-side, line-number-based expansion). Falls back to a plain notice if the file has no diff
 * data (not in `fileDiffs`) or the referenced lines aren't found — both rare (an LLM-hallucinated
 * path/range), never a crash.
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

  const baseLines = ref.base ? sideLines(data.rows, "base", ref.base) : [];
  const headLines = ref.head ? sideLines(data.rows, "head", ref.head) : [];
  if (baseLines.length === 0 && headLines.length === 0) {
    return renderFallback(ref, "The referenced lines could not be located in the diff.");
  }

  const paneMode = paneModeForRef(ref);
  const rows = buildRegionDiff(baseLines, ref.base?.start ?? 1, headLines, ref.head?.start ?? 1);
  const rowsHtml = rows.map((row) => renderSnippetRow(row, paneMode)).join("");

  const summary = `${escapeHtml(ref.path)} — ${rangeSummary(ref)}`;

  // Expansion walks the whole-file rows `data.rows` by line number (see ./assets/app.js). The
  // anchor side is head if present (else base); the snippet can grow up/down only while the
  // adjacent whole-file row is unhidden context (not a changed row — that's another change, or the
  // seam to a sibling split piece, where nothing is hidden).
  const anchor = anchorSide(ref);
  const topIdx = findRowIndexByLine(data.rows, anchor.side, anchor.range.start);
  const botIdx = findRowIndexByLine(data.rows, anchor.side, anchor.range.end);
  const canExpandUp = data.embeddable && topIdx > 0 && isContextRow(data.rows[topIdx - 1]);
  const canExpandDown =
    data.embeddable &&
    botIdx >= 0 &&
    botIdx < data.rows.length - 1 &&
    isContextRow(data.rows[botIdx + 1]);

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

  return `<div class="snippet" data-path="${escapeHtml(ref.path)}"${boundsAttrs(ref)} data-pane-mode="${paneMode}"${langAttr}>
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

/** The reference's present-side line bounds, as data attributes the client reads to walk context
 * by line number (./assets/app.js). Omits an absent side. */
function boundsAttrs(ref: SnippetRef): string {
  const parts: string[] = [];
  if (ref.base) {
    parts.push(` data-base-start="${ref.base.start}" data-base-end="${ref.base.end}"`);
  }
  if (ref.head) {
    parts.push(` data-head-start="${ref.head.start}" data-head-end="${ref.head.end}"`);
  }
  return parts.join("");
}

/** The side expansion walks by (head if present, else base) and its line range. */
function anchorSide(ref: SnippetRef): { side: "base" | "head"; range: LineRange } {
  return ref.head
    ? { side: "head", range: ref.head }
    : { side: "base", range: ref.base as LineRange };
}

function rangeSummary(ref: SnippetRef): string {
  const parts: string[] = [];
  if (ref.base) {
    parts.push(`base ${ref.base.start}-${ref.base.end}`);
  }
  if (ref.head) {
    parts.push(`head ${ref.head.start}-${ref.head.end}`);
  }
  const rowCount = totalRefLines(ref);
  return `${parts.join(", ")} (${rowCount} line${rowCount === 1 ? "" : "s"})`;
}

/** The larger of the reference's two sides' line spans (the number of rows the mini-diff renders
 * is at most this) — used only for the human-readable summary count. */
function totalRefLines(ref: SnippetRef): number {
  const baseLen = ref.base ? ref.base.end - ref.base.start + 1 : 0;
  const headLen = ref.head ? ref.head.end - ref.head.start + 1 : 0;
  return Math.max(baseLen, headLen);
}

function renderFallback(ref: SnippetRef, message: string): string {
  return `<div class="snippet snippet-unavailable">${message} (${escapeHtml(ref.path)}, ${rangeSummary(ref)})</div>`;
}

/**
 * Renders one diff row as a `<tr>`. Mirrored line-for-line in ./assets/app.js's own
 * `renderSnippetRow` (client-side context expansion inserts more rows without a server
 * round-trip — see setupSnippetExpansion there) — the two must stay byte-identical; keep them
 * in sync by hand and see snippets.test.ts's "byte-identical" parity test, which evaluates
 * app.js's copy in Node and asserts it matches this one on the same input.
 *
 * `paneMode` (default `"split"`) picks which side(s) get cells — `"head-only"`/`"base-only"`
 * render just one side's three cells, for a reference that has only that side (see
 * {@link paneModeForRef}); a two-pane split there would always show one pane blank. Each rendered
 * side also gets a narrow marker cell ("-"/"+"/blank) alongside the existing background-color
 * class (`cellTypeClass`) — an explicit add/remove signal that doesn't rely on color alone.
 */
export function renderSnippetRow(row: AlignedRow, paneMode: SnippetPaneMode = "split"): string {
  const base = paneMode !== "head-only" ? baseCells(row) : "";
  const head = paneMode !== "base-only" ? headCells(row) : "";
  return `<tr>${base}${head}</tr>`;
}

function baseCells(row: AlignedRow): string {
  return (
    `<td class="snippet-line-no side-base${cellTypeClass(row.baseType)}">${row.baseLine ?? ""}</td>` +
    `<td class="snippet-marker side-base${cellTypeClass(row.baseType)}">${row.baseType === "remove" ? "-" : ""}</td>` +
    `<td class="snippet-cell-base${cellTypeClass(row.baseType)}"><code>${row.baseText !== null ? escapeHtml(row.baseText) : ""}</code></td>`
  );
}

function headCells(row: AlignedRow): string {
  return (
    `<td class="snippet-line-no side-head${cellTypeClass(row.headType)}">${row.headLine ?? ""}</td>` +
    `<td class="snippet-marker side-head${cellTypeClass(row.headType)}">${row.headType === "add" ? "+" : ""}</td>` +
    `<td class="snippet-cell-head${cellTypeClass(row.headType)}"><code>${row.headText !== null ? escapeHtml(row.headText) : ""}</code></td>`
  );
}

function cellTypeClass(type: AlignedRow["baseType"]): string {
  return type ? ` type-${type}` : "";
}

/** The `side`'s text lines whose line number falls within `range`, in file order — the reference's
 * own base or head content, taken from the whole-file alignment. */
function sideLines(rows: AlignedRow[], side: "base" | "head", range: LineRange): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const lineNo = side === "base" ? row.baseLine : row.headLine;
    const text = side === "base" ? row.baseText : row.headText;
    if (lineNo !== null && text !== null && lineNo >= range.start && lineNo <= range.end) {
      out.push(text);
    }
  }
  return out;
}

/** The index of the whole-file row whose `side` line number equals `line`, or -1. */
function findRowIndexByLine(rows: AlignedRow[], side: "base" | "head", line: number): number {
  return rows.findIndex((row) => (side === "base" ? row.baseLine : row.headLine) === line);
}

/** True if `row` is an unchanged context row (both sides identical) — the only rows expansion
 * reveals; a changed row marks the edge of the change (or a split seam), where nothing is hidden. */
function isContextRow(row: AlignedRow | undefined): boolean {
  return row !== undefined && row.baseType === "context" && row.headType === "context";
}
