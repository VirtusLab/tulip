const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapes text for safe insertion into HTML content or a double-quoted attribute value. Use
 * for any untrusted text (file contents, PR title/description, LLM-authored text) that must be
 * displayed literally rather than interpreted as markup. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] as string);
}

/** Escapes JSON text for embedding inside an inline `<script>` element. Every `<` becomes the
 * JSON escape `\u003C`, which parses back to `<`, so the HTML tokenizer never sees `</script`
 * (which would close the element early) or `<!--` (which would put it into the escaped-script
 * state and swallow every later `<script>` on the page). */
export function escapeInlineScript(text: string): string {
  return text.replace(/</g, "\\u003C");
}
