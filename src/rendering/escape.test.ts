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
  it("neutralizes a closing </script> sequence, case-insensitively", () => {
    expect(escapeInlineScript('{"x":"</script><img onerror=1>"}')).toBe(
      '{"x":"<\\/script><img onerror=1>"}',
    );
    expect(escapeInlineScript("</SCRIPT>")).toBe("<\\/SCRIPT>");
  });

  it("leaves text with no such sequence untouched", () => {
    expect(escapeInlineScript('{"a":1}')).toBe('{"a":1}');
  });
});
