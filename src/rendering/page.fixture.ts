import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import type { FileDiffData } from "./file-diffs.js";
import { renderPage } from "./template.js";

// `import.meta.dirname`, not `new URL(..., import.meta.url)` — see highlight-safety.test.ts.
const APP_JS = readFileSync(`${import.meta.dirname}/assets/app.js`, "utf8");

/** Renders the common one-category skeleton the app.js tests mount into jsdom. `extraCategory`
 * adds a second category (`#category-1`) with that markdown. */
export function renderFixturePage(input: {
  markdown: string;
  extraCategory?: string;
  fileDiffs?: Map<string, FileDiffData>;
}): string {
  const explanations = [
    {
      category: { id: "c1", name: "C", description: "d", attention: "normal" as const },
      markdown: input.markdown,
    },
  ];
  if (input.extraCategory !== undefined) {
    explanations.push({
      category: { id: "c2", name: "D", description: "d", attention: "normal" as const },
      markdown: input.extraCategory,
    });
  }
  return renderPage({
    prTitle: "t",
    prDescription: "d",
    prUrl: "https://github.com/a/b/pull/1",
    fileDiffs: input.fileDiffs ?? new Map(),
    explanations,
  });
}

/** Loads `html` into a fresh JSDOM window (one per test, so app.js's listeners never accumulate),
 * then evaluates the real app.js and fires DOMContentLoaded. No `<script src>` is fetched by
 * JSDOM. `hash` loads the page at that fragment. `prepare` runs after the HTML is parsed and
 * before app.js, for stubs app.js must see. */
export function mountWithAppJs(
  html: string,
  options: { hash?: string; prepare?: (win: Window & typeof globalThis) => void } = {},
): Window & typeof globalThis {
  const url = options.hash ? `http://localhost/#${options.hash}` : "http://localhost/";
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  const win = dom.window as unknown as Window & typeof globalThis;
  options.prepare?.(win);
  win.eval(APP_JS);
  win.document.dispatchEvent(new win.Event("DOMContentLoaded"));
  return win;
}
