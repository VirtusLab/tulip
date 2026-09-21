import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { renderPage } from "./template.js";

// `import.meta.dirname`, not `new URL(..., import.meta.url)` — see highlight-safety.test.ts.
const APP_JS = readFileSync(`${import.meta.dirname}/assets/app.js`, "utf8");

interface Mounted {
  win: Window & typeof globalThis;
  tests: Element;
  /** Records the elements `scrollIntoView` was called on; jsdom has no implementation. */
  scrolled: Element[];
}

/** A page with an intro, a main section and a folded Tests section (`#category-0-test-1`), in
 * its own JSDOM window with the real app.js running. `hashId` is the fragment the page loads
 * with. */
function mount(hashId = ""): Mounted {
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
  const url = hashId ? `http://localhost/#${hashId}` : "http://localhost/";
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  const win = dom.window as unknown as Window & typeof globalThis;
  const scrolled: Element[] = [];
  win.Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    scrolled.push(this);
  });
  win.eval(APP_JS);
  win.document.dispatchEvent(new win.Event("DOMContentLoaded"));
  const tests = win.document.querySelector("details.section-fold#category-0-test-1");
  if (!tests) {
    throw new Error("expected a folded Tests section");
  }
  return { win, tests, scrolled };
}

describe("folded section navigation (app.js under jsdom)", () => {
  it("opens a folded section the page loads into and scrolls to it", () => {
    const { tests, scrolled } = mount("category-0-test-1");
    expect(tests.hasAttribute("open")).toBe(true);
    expect(scrolled).toEqual([tests]);
  });

  it("stays folded until navigated to, then opens on hashchange", () => {
    const { win, tests } = mount();
    expect(tests.hasAttribute("open")).toBe(false);
    win.location.hash = "#category-0-test-1";
    win.dispatchEvent(new win.Event("hashchange"));
    expect(tests.hasAttribute("open")).toBe(true);
  });

  it("opens the section on a TOC click even when the hash is already current", () => {
    const { win, tests } = mount("category-0-test-1");
    tests.removeAttribute("open");
    const link = win.document.querySelector('#toc a[href="#category-0-test-1"]');
    (link as HTMLElement).click();
    expect(tests.hasAttribute("open")).toBe(true);
  });
});
