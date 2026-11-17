import { escapeHtml } from "./escape.js";

/** Stands in for the signature while signing, so the signature can sit inside what it signs
 * (docs/adr/0032). */
export const UNSIGNED = "0".repeat(64);

/** What `tulip share` needs to know about a page (docs/adr/0032). */
export interface PageRun {
  prUrl: string;
  headSha: string;
  generatedAt: Date;
}

export type PageMetaName =
  | "tulip-pr-url"
  | "tulip-head-sha"
  | "tulip-generated-at"
  | "tulip-signature";

/** `<meta>` tags for the start of the page's `<head>`, before anything not written by Tulip. The
 * signature is {@link UNSIGNED} until the page is signed. */
export function pageRunMetaTags(run: PageRun): string {
  return [
    metaTag("tulip-pr-url", run.prUrl),
    metaTag("tulip-head-sha", run.headSha),
    metaTag("tulip-generated-at", run.generatedAt.toISOString()),
    metaTag("tulip-signature", UNSIGNED),
  ].join("\n");
}

/** The first `<meta name="{name}">` in the page's leading `<head>`, written by Tulip before any
 * content it doesn't control; later ones, e.g. in model-written text, are ignored. `offset` is
 * where the (escaped) value starts in `page`. */
export function headMeta(
  page: string,
  name: PageMetaName,
): { value: string; offset: number } | undefined {
  const start = page.indexOf("<head>");
  const end = page.indexOf("</head>");
  if (start === -1 || end < start) {
    return undefined;
  }
  const head = page.slice(0, end);
  const prefix = `<meta name="${name}" content="`;
  const at = head.indexOf(prefix, start);
  if (at === -1) {
    return undefined;
  }
  const offset = at + prefix.length;
  const close = head.indexOf('">', offset);
  if (close === -1) {
    return undefined;
  }
  return { value: unescapeHtml(head.slice(offset, close)), offset };
}

/** Puts `signature` in place of the signature found by {@link headMeta} at `offset`; both are 64
 * characters, so no other byte moves. */
export function withSignature(page: string, offset: number, signature: string): string {
  return page.slice(0, offset) + signature + page.slice(offset + signature.length);
}

function metaTag(name: PageMetaName, content: string): string {
  return `<meta name="${name}" content="${escapeHtml(content)}">`;
}

const HTML_UNESCAPES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

/** Inverts `escapeHtml`. */
function unescapeHtml(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (entity) => HTML_UNESCAPES[entity] as string);
}
