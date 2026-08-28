// @vitest-environment jsdom
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { HLJSApi } from "highlight.js";
import { describe, expect, it } from "vitest";
import { languageForPath } from "./language.js";
import type { AlignedRow } from "./line-diff.js";
import { renderSnippetRow } from "./snippets.js";

// Built by scripts/copy-assets.mjs (part of `pnpm build`) from the `highlight.js` devDependency
// — see that script's comment for why it can't just be copied like mermaid's bundle. Not
// rebuilt here (unlike the parity test's app.js slicing, which needs no build step): keeping
// this test import-free of scripts/*.mjs keeps it outside tsc's `rootDir` boundary.
// `import.meta.dirname` rather than `new URL(..., import.meta.url)` — under the jsdom test
// environment, `import.meta.url` isn't a `file:` URL.
const BUNDLE_PATH = join(import.meta.dirname, "assets/vendor/highlight.min.js");

/**
 * Proves the actual, vendored highlight.js safe API — not just app.js's wiring around it —
 * cannot turn attacker-controlled diff content into live markup. Mirrors exactly what a
 * browser does with ./snippets.ts's output: parse the server-escaped HTML into a real DOM
 * (so the payload lands purely as a text node), then run the same `highlightElement` call
 * ./assets/app.js's `highlightSnippetContainer` makes.
 */
describe("highlight.js wiring — XSS safety (real DOM, real highlighter)", () => {
  if (!existsSync(BUNDLE_PATH)) {
    it.skip("run `pnpm build` (or `node scripts/copy-assets.mjs`) first to build the vendored highlight.js bundle", () => {});
    return;
  }

  const hljsSource = readFileSync(BUNDLE_PATH, "utf8");

  function loadHljs(): HLJSApi {
    new Function(hljsSource)();
    // The bundle attaches itself to the global `window` at runtime — there's no static type.
    // biome-ignore lint/suspicious/noExplicitAny: see above
    return (window as any).hljs;
  }

  it("keeps a </script>/<img onerror> payload inert after highlighting", () => {
    const payload = `</script><img src=x onerror="alert(1)">const x = 1;`;
    const row: AlignedRow = {
      baseLine: 1,
      baseText: payload,
      baseType: "remove",
      headLine: null,
      headText: null,
      headType: null,
    };

    document.body.innerHTML = `<table><tbody>${renderSnippetRow(row)}</tbody></table>`;
    const code = document.querySelector(".snippet-cell-base code");
    expect(code).not.toBeNull();
    // Confirms the escaped server output landed as plain text, not markup, before highlighting
    // even runs.
    expect(code?.querySelector("script, img")).toBeNull();
    expect(code?.textContent).toBe(payload);

    const lang = languageForPath("src/a.ts");
    code?.classList.add(`language-${lang}`);
    loadHljs().highlightElement(code as HTMLElement);

    expect(code?.querySelector("script")).toBeNull();
    expect(code?.querySelector("img")).toBeNull();
    // The highlighter re-escapes whatever it emits — the payload survives as inert text.
    expect(code?.textContent).toBe(payload);
    expect(code?.innerHTML).toContain("hljs-");
    expect(code?.getAttribute("data-highlighted")).toBe("yes");
  });

  it("does not execute or alter untrusted markdown fence content either", () => {
    document.body.innerHTML = `<pre><code class="language-javascript">${escapeForTest(
      '"><script>alert(1)</script>',
    )}</code></pre>`;
    const code = document.querySelector("code");
    loadHljs().highlightElement(code as HTMLElement);
    expect(code?.querySelector("script")).toBeNull();
    expect(document.querySelectorAll("script")).toHaveLength(0);
  });
});

function escapeForTest(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string,
  );
}
