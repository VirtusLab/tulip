import type { LineRange } from "../diff/change.js";

/**
 * One inline reference to a source snippet within an explanation's markdown. Epic 7's renderer
 * substitutes each of these with the real, syntax-highlighted code at render time. Appears on
 * its own line, exactly matching {@link serializeSnippetRef}'s output — the fixed markup
 * contract, mirroring a `Change`'s two sides (docs/adr/0018), with `base` and/or `head` present
 * (≥1):
 *
 *   {{snippet path="<file path>" base="<bs>-<be>" head="<hs>-<he>" unfold="yes|no"}}
 *
 * An addition references `head` only, a deletion `base` only, a modification both — so one change
 * maps to one two-range reference and one rendered diff.
 */
export interface SnippetRef {
  path: string;
  base?: LineRange;
  head?: LineRange;
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

/** An own-line `{{snippet …}}` tag; its attribute list (between the name and `}}`) is parsed
 * separately, so attribute order is tolerant. */
const SNIPPET_REF_PATTERN = /^\{\{snippet (.*)\}\}$/gm;
const ATTR_PATTERN = /(\w+)="([^"]*)"/g;

/** Builds the exact markup text for `ref` — round-trips through {@link parseSnippetRefs}. Omits an
 * absent side, so an addition emits only `head=`, a deletion only `base=`. */
export function serializeSnippetRef(ref: SnippetRef): string {
  const parts = [`path="${ref.path}"`];
  if (ref.base) {
    parts.push(`base="${ref.base.start}-${ref.base.end}"`);
  }
  if (ref.head) {
    parts.push(`head="${ref.head.start}-${ref.head.end}"`);
  }
  parts.push(`unfold="${ref.unfold ? "yes" : "no"}"`);
  return `{{snippet ${parts.join(" ")}}}`;
}

/**
 * Extracts every well-formed snippet reference from `markdown`, with its position. Only tags on
 * their own line are recognized; attribute order is tolerant. A tag is dropped (left in place for
 * snippet coverage verification, see ./coverage.ts, to catch as unreferenced) when it has no
 * `path`, no valid `unfold`, neither `base` nor `head`, or a present `base`/`head` whose value
 * isn't a valid (non-backwards, 1-based) range — never throwing here.
 */
export function parseSnippetRefs(markdown: string): SnippetRefMatch[] {
  const matches: SnippetRefMatch[] = [];

  for (const match of markdown.matchAll(SNIPPET_REF_PATTERN)) {
    if (match.index === undefined) {
      continue;
    }
    const raw = match[0];
    const attrs = parseAttrs(match[1] ?? "");
    const path = attrs.get("path");
    const unfold = parseUnfold(attrs.get("unfold"));
    const base = parseOptionalRange(attrs.get("base"));
    const head = parseOptionalRange(attrs.get("head"));
    if (path === undefined || unfold === undefined || !base.ok || !head.ok) {
      continue;
    }
    if (!base.range && !head.range) {
      continue; // at least one side is required
    }
    const ref: SnippetRef = { path, unfold };
    if (base.range) {
      ref.base = base.range;
    }
    if (head.range) {
      ref.head = head.range;
    }
    matches.push({ ref, start: match.index, end: match.index + raw.length });
  }

  return matches;
}

/** Parses `key="value"` attributes from a tag's attribute text into a map (last wins). */
function parseAttrs(raw: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const match of raw.matchAll(ATTR_PATTERN)) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) {
      attrs.set(key, value);
    }
  }
  return attrs;
}

/** A side attribute is valid either by being absent (`ok`, no range) or by parsing to a range; a
 * present-but-malformed value is `ok: false`, which drops the whole ref. */
function parseOptionalRange(raw: string | undefined): { ok: boolean; range?: LineRange } {
  if (raw === undefined) {
    return { ok: true };
  }
  const range = parseLines(raw);
  return range ? { ok: true, range } : { ok: false };
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
