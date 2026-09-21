import { describe, expect, it, vi } from "vitest";
import { mountWithAppJs, renderFixturePage } from "./page.fixture.js";

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
  const html = renderFixturePage({
    markdown: "Intro.\n\n## What changed\n\nMain.\n\n## Tests\n\nTest prose.\n",
  });
  const scrolled: Element[] = [];
  const win = mountWithAppJs(html, {
    ...(hashId ? { hash: hashId } : {}),
    prepare(prepWin) {
      prepWin.Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
        scrolled.push(this);
      });
    },
  });
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
