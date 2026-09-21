import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import type { CategoryExplanation } from "../explanations/types.js";
import type { FileDiffData } from "./file-diffs.js";
import { renderPage } from "./template.js";

// `import.meta.dirname`, not `new URL(..., import.meta.url)` — see highlight-safety.test.ts.
const APP_JS = readFileSync(`${import.meta.dirname}/assets/app.js`, "utf8");

/** Renders a page with the common one-category skeleton the app.js tests mount into jsdom.
 * Pass `markdown`, `fileDiffs` and/or `explanations` to override the defaults; `explanations`
 * replaces the single default category outright, for tests that need more than one. */
export function renderFixturePage(
  overrides: {
    markdown?: string;
    fileDiffs?: Map<string, FileDiffData>;
    explanations?: CategoryExplanation[];
  } = {},
): string {
  const explanations = overrides.explanations ?? [
    {
      category: { id: "c1", name: "C", description: "d", attention: "normal" },
      markdown: overrides.markdown ?? "Intro.\n\n## What changed\n\nBody.\n",
    },
  ];
  return renderPage({
    prTitle: "t",
    prDescription: "d",
    prUrl: "https://github.com/a/b/pull/1",
    fileDiffs: overrides.fileDiffs ?? new Map(),
    explanations,
  });
}

/** Loads `html` into a fresh JSDOM window (one per test, so app.js's listeners never accumulate),
 * runs `prepare` for any per-test stubs (a stand-in `mermaid`, a `scrollIntoView` recorder, a
 * `clientWidth` stub, ...), then evaluates the real app.js and fires DOMContentLoaded. No
 * `<script src>` is fetched by JSDOM. `hash` loads the page at that fragment. */
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
