import { Marked } from "marked";
import { escapeHtml } from "./escape.js";

/**
 * Converts one markdown string (prose only — no mermaid fences or `{{snippet}}` markers, see
 * ./markdown.ts's `renderCategoryMarkdown` for those) to HTML, safely: raw inline/block HTML in
 * the source is escaped rather than passed through, and link/image URLs are checked against a
 * scheme allowlist, since this markdown is LLM-authored, untrusted text (spec: "XSS-safe: file
 * contents and LLM output are untrusted text — never inject raw into HTML"). Code spans/blocks
 * are escaped by marked itself by default.
 */
export function renderProseMarkdown(markdown: string): string {
  return marked.parse(markdown, { async: false });
}

// marked's own `cleanUrl` only `encodeURI`s a link/image href — it never checks the scheme, so
// `javascript:`/`data:`/`vbscript:` URLs pass straight through as a clickable link or an <img
// src> (verified against the installed marked@18: its default `link`/`image` renderers hand the
// href to `cleanUrl` and use the result as-is). A relative reference (no scheme — a path, query
// string, or fragment) is always safe; an absolute one is safe only under this allowlist.
const ALLOWED_URL_SCHEMES = /^(https?|mailto):/i;
const URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

function isSafeHref(href: string): boolean {
  const trimmed = href.trim();
  return !URL_SCHEME_PATTERN.test(trimmed) || ALLOWED_URL_SCHEMES.test(trimmed);
}

function titleAttr(title: string | null | undefined): string {
  return title ? ` title="${escapeHtml(title)}"` : "";
}

const marked = new Marked({
  renderer: {
    // marked's default renderer passes raw HTML tokens through verbatim — the main XSS vector
    // for untrusted markdown. Escape instead of rendering.
    html(token) {
      return escapeHtml(token.text);
    },
    // Neutralize an unsafe scheme: drop the href but keep the visible link text, rather than
    // dropping the whole link — the surrounding sentence still reads correctly.
    link(token) {
      const text = this.parser.parseInline(token.tokens);
      if (!isSafeHref(token.href)) {
        return text;
      }
      return `<a href="${escapeHtml(token.href)}"${titleAttr(token.title)}>${text}</a>`;
    },
    // Neutralize an unsafe scheme by omitting the image entirely — unlike a link, there's no
    // useful visible fallback to keep.
    image(token) {
      if (!isSafeHref(token.href)) {
        return "";
      }
      const alt = token.tokens.length
        ? this.parser.parseInline(token.tokens, this.parser.textRenderer)
        : token.text;
      return `<img src="${escapeHtml(token.href)}" alt="${escapeHtml(alt)}"${titleAttr(token.title)}>`;
    },
  },
});
