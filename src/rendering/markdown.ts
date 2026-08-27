import { Marked } from "marked";
import { escapeHtml } from "./escape.js";

/**
 * Converts one markdown string (prose only — no mermaid fences or `{{snippet}}` markers, see
 * ./mermaid.ts and ./snippets.ts for those) to HTML, safely: raw inline/block HTML in the
 * source is escaped rather than passed through, since this markdown is LLM-authored, untrusted
 * text (spec: "XSS-safe: file contents and LLM output are untrusted text — never inject raw
 * into HTML"). Code spans/blocks are escaped by marked itself by default.
 */
export function renderProseMarkdown(markdown: string): string {
  return marked.parse(markdown, { async: false });
}

const marked = new Marked({
  renderer: {
    // marked's default renderer passes raw HTML tokens through verbatim — the main XSS vector
    // for untrusted markdown. Escape instead of rendering.
    html(token) {
      return escapeHtml(token.text);
    },
  },
});
