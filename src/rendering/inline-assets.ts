import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** The page's stylesheet and scripts as text, for a single-file page (docs/adr/0030). */
export interface InlineAssets {
  /** `style.css` with each `vendor/fonts/*.woff2` reference replaced by a data URI. */
  style: string;
  /** Script bodies in page order: mermaid, highlight.js, app.js. */
  scripts: string[];
}

/** Reads one asset file. Mockable in tests. */
export type AssetReader = (path: string) => Promise<Buffer>;

const SCRIPT_FILES = ["vendor/mermaid.min.js", "vendor/highlight.min.js", "app.js"];
const FONT_URL = /url\("(vendor\/fonts\/[\w.-]+\.woff2)"\)/g;

/** Loads `assetsDir`'s stylesheet, fonts and scripts so the page can embed them. */
export async function loadInlineAssets(
  assetsDir: string,
  read: AssetReader = readFile,
): Promise<InlineAssets> {
  const css = (await read(join(assetsDir, "style.css"))).toString("utf8");
  const fontPaths = [...new Set([...css.matchAll(FONT_URL)].map((match) => match[1] as string))];
  const fontUris = new Map<string, string>();
  for (const fontPath of fontPaths) {
    const font = await read(join(assetsDir, fontPath));
    fontUris.set(fontPath, `data:font/woff2;base64,${font.toString("base64")}`);
  }
  const style = css.replace(FONT_URL, (_, fontPath: string) => `url("${fontUris.get(fontPath)}")`);

  const scripts = [];
  for (const file of SCRIPT_FILES) {
    scripts.push(escapeScriptSource((await read(join(assetsDir, file))).toString("utf8")));
  }
  return { style, scripts };
}

/**
 * Makes JS source safe to place inside an inline `<script>` element. `</script` would close the
 * element early, and `<!--` or `<script` can put the HTML tokenizer into its script-escape states.
 * Each `<` that starts one becomes `\x3C`, which reads as `<` inside a JS string or regex literal,
 * the only places these bundles contain them (inline-assets.test.ts compiles each bundle to prove
 * it).
 */
export function escapeScriptSource(source: string): string {
  return source.replace(/<(?=!--|\/?script)/gi, "\\x3C");
}
