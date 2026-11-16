import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The page's stylesheet and scripts as text, embedded into `index.html` (docs/adr/0030). */
export interface InlineAssets {
  /** `style.css` with each `vendor/fonts/*.woff2` reference replaced by a data URI, preceded by a
   * comment carrying the fonts' licenses. */
  style: string;
  /** Script bodies in page order, each already passed through {@link inlineScriptText}. */
  scripts: string[];
}

const SCRIPT_FILES = ["vendor/mermaid.min.js", "vendor/highlight.min.js", "app.js"];
const FONT_URL = /url\("(vendor\/fonts\/[\w.-]+\.woff2)"\)/g;

/** Loads `assetsDir`'s stylesheet, the fonts it references with their licenses, and the scripts,
 * so the page can embed them.
 * `assetsDir` defaults to the bundled assets: src/rendering/assets in dev, dist/rendering/assets
 * once built. Fails when a file is missing, e.g. before `pnpm build` creates the gitignored
 * `vendor/` files (scripts/copy-assets.mjs). */
export async function loadInlineAssets(
  // Resolved on call, not at import: jsdom tests import this module without a file: URL.
  assetsDir: string = fileURLToPath(new URL("./assets", import.meta.url)),
): Promise<InlineAssets> {
  const read = (path: string) => readFile(join(assetsDir, path), "utf8");

  const css = await read("style.css");
  const fontPaths = [...new Set([...css.matchAll(FONT_URL)].map((match) => match[1] as string))];
  const fontUris = new Map<string, string>();
  for (const fontPath of fontPaths) {
    const font = await readFile(join(assetsDir, fontPath));
    fontUris.set(fontPath, `data:font/woff2;base64,${font.toString("base64")}`);
  }
  // scripts/copy-assets.mjs writes each font's license under this name.
  const licenses = await Promise.all(
    fontPaths.map((fontPath) => read(fontPath.replace(/\.woff2$/, ".LICENSE.txt"))),
  );
  const style =
    fontLicenseComment(licenses) +
    css.replace(FONT_URL, (_, fontPath: string) => `url("${fontUris.get(fontPath)}")`);

  const scripts = [];
  for (const file of SCRIPT_FILES) {
    scripts.push(inlineScriptText(await read(file)));
  }
  return { style, scripts };
}

/**
 * The fonts' licenses as one CSS comment, as the OFL asks of an embedded font. Each license is a
 * copyright line followed by the license text; fonts that share the same text list their copyright
 * lines together above one copy of it.
 */
export function fontLicenseComment(licenses: string[]): string {
  const copyrightsByText = new Map<string, string[]>();
  for (const license of licenses) {
    const [copyright = "", ...rest] = license.split("\n");
    const text = rest.join("\n").trim();
    copyrightsByText.set(text, [...(copyrightsByText.get(text) ?? []), copyright]);
  }
  const blocks = [...copyrightsByText].map(([text, copyrights]) =>
    [...copyrights, "", text].join("\n"),
  );
  return blocks.length === 0 ? "" : `/*\n${blocks.join("\n\n").replaceAll("*/", "* /")}\n*/\n`;
}

/**
 * Makes JS source safe as the text of an inline `<script>` element, and equal to what the browser
 * hashes for the CSP. `</script` would close the element early, and `<!--` can put the HTML
 * tokenizer into its script-escape states; with every `<!--` gone it never enters them, so
 * `<script` is left alone. The escapes (`<\/script`, `<\x21--`) read the same inside a JS string or
 * regex literal, the only places these bundles contain them (inline-assets.test.ts compiles each
 * bundle to prove it). They go after the `<`, not on it, because a `\` before the `<` would
 * otherwise combine with the escape. Throws on a NUL, which the HTML parser would replace.
 */
export function inlineScriptText(js: string): string {
  if (js.includes("\0")) {
    throw new Error("an inline script can't contain a NUL character");
  }
  return (
    js
      // The HTML parser turns CRLF and CR into LF before the browser hashes the script.
      .replace(/\r\n?/g, "\n")
      .replace(/<\/(script)/gi, "<\\/$1")
      .replaceAll("<!--", "<\\x21--")
  );
}

/** The CSP source (`'sha256-…'`) allowing an inline script whose text is `script`. */
export function scriptHash(script: string): string {
  return `'sha256-${createHash("sha256").update(script).digest("base64")}'`;
}
