import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Relative to the assets dir, in the order ./template.ts links them. */
export const PAGE_SCRIPTS = ["vendor/mermaid.min.js", "vendor/highlight.min.js", "app.js"];

export interface InlineAssets {
  css: string;
  scripts: string[];
}

const FONT_URL = /url\("(vendor\/fonts\/[^"]+\.woff2)"\)/g;

export async function loadInlineAssets(assetsDir: string): Promise<InlineAssets> {
  const [css, scripts] = await Promise.all([
    readFile(join(assetsDir, "style.css"), "utf8").then((css) => inlineFonts(assetsDir, css)),
    Promise.all(PAGE_SCRIPTS.map((path) => readFile(join(assetsDir, path), "utf8"))),
  ]);
  return { css, scripts: scripts.map(inlineScriptText) };
}

async function inlineFonts(assetsDir: string, css: string): Promise<string> {
  const fontPaths = [...new Set([...css.matchAll(FONT_URL)].map((match) => match[1] as string))];
  const fontUrls = new Map(
    await Promise.all(
      fontPaths.map(async (path) => {
        const font = await readFile(join(assetsDir, path));
        return [path, `data:font/woff2;base64,${font.toString("base64")}`] as const;
      }),
    ),
  );
  return css.replace(FONT_URL, (_, path: string) => `url("${fontUrls.get(path)}")`);
}

/** In JS these sequences only occur in strings, regexes and comments, where `\/` and `\x21` still
 * mean `/` and `!`, `/u` regexes included; left as-is, the HTML tokenizer would end the element
 * early or swallow later scripts. Line endings are made LF because the browser does that before
 * hashing the script for the CSP. */
function inlineScriptText(js: string): string {
  return js
    .replace(/\r\n?/g, "\n")
    .replace(/<\/(script)/gi, "<\\/$1")
    .replace(/<!--/g, "<\\x21--");
}

export function scriptHash(script: string): string {
  return `'sha256-${createHash("sha256").update(script, "utf8").digest("base64")}'`;
}
