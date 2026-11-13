import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { escapeScriptSource, loadInlineAssets } from "./inline-assets.js";

const FILES: Record<string, string> = {
  "/a/style.css": 'body{} @font-face{src:url("vendor/fonts/inter.woff2") format("woff2")}',
  "/a/vendor/fonts/inter.woff2": "FONT",
  "/a/vendor/mermaid.min.js": "var m='<!-- x -->';",
  "/a/vendor/highlight.min.js": "var h=1;",
  "/a/app.js": "var a=2;",
};

async function fakeRead(path: string): Promise<Buffer> {
  const content = FILES[path];
  if (content === undefined) {
    throw new Error(`unexpected read: ${path}`);
  }
  return Buffer.from(content);
}

describe("loadInlineAssets", () => {
  it("replaces each font reference with a base64 data URI", async () => {
    const { style } = await loadInlineAssets("/a", fakeRead);

    expect(style).toContain(
      `url("data:font/woff2;base64,${Buffer.from("FONT").toString("base64")}")`,
    );
    expect(style).not.toContain("vendor/fonts");
  });

  it("returns the scripts in page order, escaped for an inline <script>", async () => {
    const { scripts } = await loadInlineAssets("/a", fakeRead);

    expect(scripts).toEqual(["var m='\\x3C!-- x -->';", "var h=1;", "var a=2;"]);
  });
});

describe("escapeScriptSource", () => {
  it.each([
    ["'</script>'", "'\\x3C/script>'"],
    ["'</SCRIPT>'", "'\\x3C/SCRIPT>'"],
    ["'<script>'", "'\\x3Cscript>'"],
    ["'<!--'", "'\\x3C!--'"],
    ["a<b && '<div>'", "a<b && '<div>'"],
  ])("escapes %s", (source, expected) => {
    expect(escapeScriptSource(source)).toBe(expected);
  });

  it("keeps the value of a string literal", () => {
    const escaped = escapeScriptSource("'<!-- </script> <script>'");

    expect(new Script(escaped).runInNewContext()).toBe("<!-- </script> <script>");
  });

  // A match outside a string or regex literal would make the escaped bundle fail to compile.
  it.each([
    ["mermaid", `${import.meta.dirname}/../../node_modules/mermaid/dist/mermaid.min.js`],
    ["highlight.js", `${import.meta.dirname}/assets/vendor/highlight.min.js`],
    ["app.js", `${import.meta.dirname}/assets/app.js`],
  ])("leaves the real %s bundle compilable and free of tag openers", (_, path) => {
    const escaped = escapeScriptSource(readFileSync(path, "utf8"));

    expect(() => new Script(escaped)).not.toThrow();
    expect(escaped).not.toMatch(/<(!--|\/?script)/i);
  });
});
