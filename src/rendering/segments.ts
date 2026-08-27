import { renderProseMarkdown } from "./prose.js";

/** A non-prose span within a markdown string (a mermaid fence, a `{{snippet}}` marker, ...)
 * that must bypass normal markdown processing and be rendered specially instead. */
export interface Segment {
  /** Offset of the segment's first character in the source markdown. */
  start: number;
  /** Offset just past the segment's last character. */
  end: number;
  render(): string;
}

/**
 * Splices `segments` into `markdown`, rendering the prose between/around them with
 * {@link renderProseMarkdown} and each segment with its own `render()`. Segments are sorted by
 * position; an overlapping segment (starts before the previous one ended) is dropped rather
 * than risking mangled output — the markup contract guarantees mermaid fences and snippet
 * refs never overlap in well-formed input.
 */
export function renderWithSegments(markdown: string, segments: Segment[]): string {
  const ordered = [...segments].sort((a, b) => a.start - b.start);
  let html = "";
  let cursor = 0;
  for (const segment of ordered) {
    if (segment.start < cursor) {
      continue;
    }
    html += renderProseMarkdown(markdown.slice(cursor, segment.start));
    html += segment.render();
    cursor = segment.end;
  }
  html += renderProseMarkdown(markdown.slice(cursor));
  return html;
}
