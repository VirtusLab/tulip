import type { DiffSide, LineRange } from "../diff/change.js";

/**
 * One inline reference to a source snippet within an explanation's markdown. Epic 7's renderer
 * substitutes each of these with the real, syntax-highlighted code at render time. Appears on
 * its own line, exactly matching {@link serializeSnippetRef}'s output — the fixed markup
 * contract:
 *
 *   {{snippet path="<file path>" side="base|head" lines="<start>-<end>" unfold="yes|no"}}
 */
export interface SnippetRef {
  path: string;
  side: DiffSide;
  lines: LineRange;
  /** Whether the snippet should render expanded by default — false ("no") for supporting
   * changes that aren't crucial to understanding the explanation on its own. */
  unfold: boolean;
}

/** A {@link SnippetRef} as found in a markdown string, with its position (character offsets
 * into that string) so a renderer can splice the real code in at exactly that spot. */
export interface SnippetRefMatch {
  ref: SnippetRef;
  /** Offset of the tag's first character. */
  start: number;
  /** Offset just past the tag's last character. */
  end: number;
}

const SNIPPET_REF_PATTERN =
  /^\{\{snippet path="([^"]*)" side="([^"]*)" lines="([^"]*)" unfold="([^"]*)"\}\}$/gm;

/** Builds the exact markup text for `ref` — round-trips through {@link parseSnippetRefs}. */
export function serializeSnippetRef(ref: SnippetRef): string {
  const unfold = ref.unfold ? "yes" : "no";
  return `{{snippet path="${ref.path}" side="${ref.side}" lines="${ref.lines.start}-${ref.lines.end}" unfold="${unfold}"}}`;
}

/**
 * Extracts every well-formed snippet reference from `markdown`, with its position. Only tags on
 * their own line, matching the fixed contract exactly, are recognized. A tag whose `side`,
 * `lines`, or `unfold` value doesn't match the contract (e.g. an unknown side, a non-numeric or
 * backwards line range, an unfold value other than "yes"/"no") is simply not returned — it's
 * left in place for snippet coverage verification (see ./coverage.ts) to catch as an
 * unreferenced change, rather than throwing here.
 */
export function parseSnippetRefs(markdown: string): SnippetRefMatch[] {
  const matches: SnippetRefMatch[] = [];

  for (const match of markdown.matchAll(SNIPPET_REF_PATTERN)) {
    if (match.index === undefined) {
      continue;
    }
    const raw = match[0];
    const path = match[1];
    const side = parseSide(match[2]);
    const lines = parseLines(match[3]);
    const unfold = parseUnfold(match[4]);
    if (path === undefined || side === undefined || lines === undefined || unfold === undefined) {
      continue;
    }
    matches.push({
      ref: { path, side, lines, unfold },
      start: match.index,
      end: match.index + raw.length,
    });
  }

  return matches;
}

/** An inline backlink to another category's section (docs/adr/0015), emitted mid-prose by the
 * explainer as `{{catref id="c3"}}`. Unlike {@link SnippetRef} it is NOT own-line and NOT
 * block-rendered: it's rewritten to a markdown link before the prose is parsed (see
 * {@link substituteCategoryRefs}), so it can sit in the middle of a sentence without splitting
 * it. The attributed form is required — a bare `{{catref}}` would match the prompt loader's
 * placeholder pattern and throw (docs/adr/0006). */
const CATEGORY_REF_PATTERN = /\{\{catref id="([^"]*)"\}\}/g;

/** Where a {@link substituteCategoryRefs} backlink points: a category's array position (its
 * `#category-<index>` anchor — see src/rendering/ids.ts) and display name (the link text). */
export interface CategoryRefTarget {
  index: number;
  title: string;
}

/**
 * Rewrites every `{{catref id="x"}}` in `markdown` to a markdown link
 * `[<title>](#category-<index>)`, resolving `x` through `targets`. An id not in `targets`
 * (unknown or malformed) is left as literal text — never a crash, mirroring
 * {@link parseSnippetRefs}' leniency. Title and index come from `targets` (the renderer), so the
 * link text always matches the real section; the agent supplies only the id. Meant to run as a
 * text-level pre-substitution before the markdown is parsed, since a catref is inline.
 */
export function substituteCategoryRefs(
  markdown: string,
  targets: ReadonlyMap<string, CategoryRefTarget>,
): string {
  return markdown.replace(CATEGORY_REF_PATTERN, (raw, id: string) => {
    const target = targets.get(id);
    if (!target) {
      return raw;
    }
    // Escape the link-text brackets so a title containing them can't break the `[...]( ...)`
    // syntax (titles are LLM-authored text); marked renders `\[`/`\]` as literal brackets.
    const text = target.title.replace(/[\\[\]]/g, "\\$&");
    return `[${text}](#category-${target.index})`;
  });
}

function parseSide(raw: string | undefined): DiffSide | undefined {
  return raw === "base" || raw === "head" ? raw : undefined;
}

function parseLines(raw: string | undefined): LineRange | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const match = /^(\d+)-(\d+)$/.exec(raw);
  if (!match) {
    return undefined;
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start < 1 || end < start) {
    return undefined;
  }
  return { start, end };
}

function parseUnfold(raw: string | undefined): boolean | undefined {
  if (raw === "yes") return true;
  if (raw === "no") return false;
  return undefined;
}
