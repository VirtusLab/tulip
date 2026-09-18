import type { SnippetRef } from "../explanations/markup.js";
import { escapeHtml } from "./escape.js";
import type { FileDiffData } from "./file-diffs.js";
import { isProseLanguage, languageForPath } from "./language.js";
import type { AlignedRow } from "./line-diff.js";
import {
  buildSnippetPieces,
  type GapPosition,
  type SnippetBlock,
  type SnippetPaneMode,
} from "./snippet-blocks.js";

export type { SnippetPaneMode } from "./snippet-blocks.js";

/**
 * Renders a run of `{{snippet}}` refs to one file (consecutive in the markdown — see
 * ./markdown.ts) as one diff block: a collapsible `<details>` holding the refs' regions in file
 * order, with a gap row for each hidden range between, above and below them (docs/adr/0021).
 * Each region's lines are aligned on their own (docs/adr/0018), and gap rows let ./assets/app.js
 * reveal the whole-file rows around them in steps. A ref that can't be rendered (unknown path,
 * lines not in the diff, or lines overlapping an earlier ref's) splits the run and renders a
 * plain notice in its place; the pieces around it render as separate blocks.
 *
 * `forceCollapsed` overrides every ref's `unfold` to collapsed — set by ./markdown.ts for a
 * "## Test code" subsection (see ./sections.ts).
 */
export function renderSnippetBlock(
  refs: SnippetRef[],
  fileDiffs: Map<string, FileDiffData>,
  forceCollapsed = false,
): string {
  return buildSnippetPieces(refs, fileDiffs, forceCollapsed)
    .map((piece) =>
      piece.kind === "block" ? renderBlock(piece.block) : renderFallback(piece.ref, piece.reason),
    )
    .join("\n");
}

function renderBlock(block: SnippetBlock): string {
  const body = block.items
    .map((item) =>
      item.kind === "region"
        ? item.region.rows.map((row) => renderSnippetRow(row, block.paneMode)).join("")
        : renderGapRow(
            item.gap.from,
            item.gap.to,
            item.gap.position,
            block.paneMode,
            block.embeddable,
          ),
    )
    .join("");

  const ranges = block.regions.map((region) => refRanges(region.ref)).join("; ");
  const lines = block.regions.reduce((sum, region) => sum + region.lines, 0);
  const summary = `${escapeHtml(block.path)} — ${ranges} (${lines} line${lines === 1 ? "" : "s"})`;

  // Language is guessed from the path only (a small, fixed lookup table — see ./language.ts),
  // never from file content, so it can't be steered by attacker-controlled text. It rides on
  // the container so the client (./assets/app.js) can highlight already-escaped cells.
  const lang = languageForPath(block.path);
  const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : "";

  // Prose/doc files wrap long lines instead of scrolling horizontally (see style.css's
  // `.snippet-wrap`, whose fixed table layout is why the colgroup below exists).
  const scrollClass = isProseLanguage(lang) ? "snippet-scroll snippet-wrap" : "snippet-scroll";

  return `<div class="snippet" data-path="${escapeHtml(block.path)}" data-pane-mode="${block.paneMode}"${langAttr}>
<details${block.open ? " open" : ""}>
<summary>${summary}</summary>
<div class="${scrollClass}">
<table class="snippet-table">${colgroup(block.paneMode)}<tbody>
${body}
</tbody></table>
</div>
</details>
</div>`;
}

/** Column widths for the gutters. Under `table-layout: fixed` a table takes its widths from the
 * first row, which may now be a gap row with one spanning cell. */
function colgroup(paneMode: SnippetPaneMode): string {
  const side = '<col class="snippet-col-line-no"><col class="snippet-col-marker"><col>';
  return `<colgroup>${paneMode === "split" ? side + side : side}</colgroup>`;
}

/** `base a-b, head c-d` for the sides a ref has. */
function refRanges(ref: SnippetRef): string {
  const parts: string[] = [];
  if (ref.base) {
    parts.push(`base ${ref.base.start}-${ref.base.end}`);
  }
  if (ref.head) {
    parts.push(`head ${ref.head.start}-${ref.head.end}`);
  }
  return parts.join(", ");
}

function renderFallback(ref: SnippetRef, message: string): string {
  const baseLen = ref.base ? ref.base.end - ref.base.start + 1 : 0;
  const headLen = ref.head ? ref.head.end - ref.head.start + 1 : 0;
  const lines = Math.max(baseLen, headLen);
  return `<div class="snippet snippet-unavailable">${message} (${escapeHtml(ref.path)}, ${refRanges(ref)} (${lines} line${lines === 1 ? "" : "s"}))</div>`;
}

/**
 * Renders one diff row as a `<tr>`. Mirrored line-for-line in ./assets/app.js's own
 * `renderSnippetRow` (client-side context expansion inserts more rows without a server
 * round-trip — see setupSnippetExpansion there) — the two must stay byte-identical; keep them
 * in sync by hand and see snippets.test.ts's "byte-identical" parity test, which evaluates
 * app.js's copy in Node and asserts it matches this one on the same input.
 *
 * `paneMode` (default `"split"`) picks which side(s) get cells — `"head-only"`/`"base-only"`
 * render just one side's three cells, for a block whose file has only that side; a two-pane split
 * there would always show one pane blank. Each rendered side also gets a narrow marker cell
 * ("-"/"+"/blank) alongside the existing background-color class (`cellTypeClass`) — an explicit
 * add/remove signal that doesn't rely on color alone.
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

/** Rows one click reveals. Mirrored as `EXPAND_STEP` in ./assets/app.js. */
export const EXPAND_STEP = 20;

/**
 * Renders a gap row: the control for a hidden range `[from, to]` of whole-file row indices
 * (docs/adr/0021). Mirrored line-for-line in ./assets/app.js, which re-renders the row after
 * each partial expansion — the two must stay byte-identical (see the parity test). A range of
 * at most `EXPAND_STEP` rows gets one button revealing it all; a larger one gets a step button
 * per direction, except that the top gap has no region above to grow from and the bottom gap
 * none below. Over the embed cap there is nothing to reveal, so only the label renders.
 */
export function renderGapRow(
  from: number,
  to: number,
  position: GapPosition,
  paneMode: SnippetPaneMode,
  embeddable: boolean,
): string {
  const count = to - from + 1;
  const unit = count === 1 ? "line" : "lines";
  let controls = `<span class="snippet-gap-label">⋯ ${count} ${unit}</span>`;
  if (embeddable && count <= EXPAND_STEP) {
    controls = `<button type="button" class="snippet-gap-btn" data-dir="all">expand ${count} ${unit}</button>`;
  } else if (embeddable) {
    const up =
      position === "bottom"
        ? ""
        : `<button type="button" class="snippet-gap-btn" data-dir="up">↑ ${EXPAND_STEP}</button>`;
    const down =
      position === "top"
        ? ""
        : `<button type="button" class="snippet-gap-btn" data-dir="down">↓ ${EXPAND_STEP}</button>`;
    controls = `${up}${controls}${down}`;
  }
  const colspan = paneMode === "split" ? 6 : 3;
  return `<tr class="snippet-gap" data-from="${from}" data-to="${to}" data-position="${position}"><td colspan="${colspan}">${controls}</td></tr>`;
}
