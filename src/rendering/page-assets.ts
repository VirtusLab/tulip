import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The page's stylesheet and scripts (docs/adr/0030, docs/adr/0033). */
export interface PageAssets {
  /** `style.css` with each `vendor/fonts/*.woff2` reference replaced by a data URI, preceded by a
   * comment carrying the fonts' licenses. */
  style: string;
  /** In page order. */
  scripts: PageScript[];
}

/** A script embedded in the page (`text`, already passed through {@link inlineScriptText}), or
 * loaded from a CDN (`src`, checked against `integrity`). */
export type PageScript = { text: string } | { src: string; integrity: string };

export interface PageAssetsOptions {
  /** Embed mermaid instead of loading it from jsDelivr, so the page needs no network. */
  offline: boolean;
}

const MERMAID_FILE = "vendor/mermaid.min.js";
// scripts/copy-assets.mjs writes the version of the mermaid package it copied the bundle from.
const MERMAID_VERSION_FILE = "vendor/mermaid.version";
const INLINE_SCRIPT_FILES = ["vendor/highlight.min.js", "app.js"];
const FONT_URL = /url\("(vendor\/fonts\/[\w.-]+\.woff2)"\)/g;

/** Loads `assetsDir`'s stylesheet, the fonts it references with their licenses, and the scripts,
 * for the page. Mermaid is embedded only when `offline`; otherwise the page loads it from
 * jsDelivr, pinned to the vendored copy by an SRI hash.
 * `assetsDir` defaults to the bundled assets: src/rendering/assets in dev, dist/rendering/assets
 * once built. Fails when a file is missing, e.g. before `pnpm build` creates the gitignored
 * `vendor/` files (scripts/copy-assets.mjs). */
export async function loadPageAssets(
  options: PageAssetsOptions,
  // Resolved on call, not at import: jsdom tests import this module without a file: URL.
  assetsDir: string = fileURLToPath(new URL("./assets", import.meta.url)),
): Promise<PageAssets> {
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

  const mermaid = await readFile(join(assetsDir, MERMAID_FILE));
  const scripts: PageScript[] = [
    options.offline
      ? { text: inlineScriptText(mermaid.toString("utf8")) }
      : {
          src: mermaidCdnUrl((await read(MERMAID_VERSION_FILE)).trim()),
          integrity: subresourceIntegrity(mermaid),
        },
  ];
  for (const file of INLINE_SCRIPT_FILES) {
    scripts.push({ text: inlineScriptText(await read(file)) });
  }
  return { style, scripts };
}

/** jsDelivr serves the npm package's files unchanged, so this is the vendored bundle. The URL
 * also goes into the CSP, where a space would add another source: hence the strict version. */
export function mermaidCdnUrl(version: string): string {
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
    throw new Error(`unexpected mermaid version: ${JSON.stringify(version)}`);
  }
  return `https://cdn.jsdelivr.net/npm/mermaid@${version}/dist/mermaid.min.js`;
}

/** The `integrity` attribute value for a file whose bytes are `content`. */
export function subresourceIntegrity(content: Buffer): string {
  return `sha384-${createHash("sha384").update(content).digest("base64")}`;
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
 * regex literal, the only places these bundles contain them (page-assets.test.ts compiles each
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
