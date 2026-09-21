import { describe, expect, it } from "vitest";
import { escapeHtml, escapeInlineScript } from "./escape.js";

describe("escapeHtml", () => {
  it("escapes all HTML-significant characters", () => {
    expect(escapeHtml(`<script>alert('x')</script> & "quoted"`)).toBe(
      "&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; &quot;quoted&quot;",
    );
  });

  it("leaves plain text untouched", () => {
    expect(escapeHtml("just plain text 123")).toBe("just plain text 123");
  });
});

describe("escapeInlineScript", () => {
  it("neutralizes every `<`, so neither </script> nor <!-- can reach the HTML tokenizer", () => {
    const escaped = escapeInlineScript('{"x":"</script><!--<script><img onerror=1>"}');
    expect(escaped).not.toContain("<");
    expect(escaped).toBe('{"x":"\\u003C/script>\\u003C!--\\u003Cscript>\\u003Cimg onerror=1>"}');
  });

  it("stays valid JSON that parses back to the original text", () => {
    const original = { x: "</SCRIPT><!--<script>" };
    expect(JSON.parse(escapeInlineScript(JSON.stringify(original)))).toEqual(original);
  });

  it("leaves text with no `<` untouched", () => {
    expect(escapeInlineScript('{"a":1}')).toBe('{"a":1}');
  });
});
