import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { renderPage } from "./template.js";

// `import.meta.dirname`, not `new URL(..., import.meta.url)` — see highlight-safety.test.ts.
const APP_JS = readFileSync(`${import.meta.dirname}/assets/app.js`, "utf8");

/** A page with an intro, a main section and a folded Tests section, in its own JSDOM window
 * with the real app.js running. `hash` sets the URL fragment the page loads with. */
function mount(hash = ""): Window & typeof globalThis {
  const html = renderPage({
    prTitle: "t",
    prDescription: "d",
    prUrl: "https://github.com/a/b/pull/1",
    fileDiffs: new Map(),
    explanations: [
      {
        category: { id: "c1", name: "C", description: "d", attention: "normal" },
        markdown: "Intro.\n\n## What changed\n\nMain.\n\n## Tests\n\nTest prose.\n",
      },
    ],
  });
  const dom = new JSDOM(html, { url: `http://localhost/${hash}`, runScripts: "outside-only" });
  dom.window.eval(APP_JS);
  dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  return dom.window as unknown as Window & typeof globalThis;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("folded sections (app.js under jsdom)", () => {
  it("opens a folded section the page loads into", () => {
    const win = mount("#category-0-test-1");
    const details = win.document.querySelector("details.subsection-fold#category-0-test-1");
    expect(details?.hasAttribute("open")).toBe(true);
  });

  it("stays folded until navigated to, then opens on hashchange", async () => {
    const win = mount();
    const details = win.document.querySelector("details.subsection-fold#category-0-test-1");
    expect(details?.hasAttribute("open")).toBe(false);
    win.location.hash = "#category-0-test-1";
    win.dispatchEvent(new win.Event("hashchange"));
    await settle();
    expect(details?.hasAttribute("open")).toBe(true);
  });

  it("opens the section on a TOC click even when the hash is already current", async () => {
    const win = mount("#category-0-test-1");
    const details = win.document.querySelector("details.subsection-fold#category-0-test-1");
    details?.removeAttribute("open");
    const link = win.document.querySelector('#toc a[href="#category-0-test-1"]');
    (link as HTMLElement).click();
    await settle();
    expect(details?.hasAttribute("open")).toBe(true);
  });
});
