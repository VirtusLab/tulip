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

/** Escapes a JSON string (or any text) for safe embedding inside an inline `<script>` element:
 * neutralizes `</script` sequences that would otherwise prematurely close the tag. */
export function escapeInlineScript(text: string): string {
  return text.replace(/<\/(script)/gi, "<\\/$1");
}
