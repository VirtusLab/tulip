import { describe, expect, it } from "vitest";
import { mountWithAppJs, renderFixturePage } from "./page.fixture.js";

const STORAGE_KEY = "tulip-toc-folded";

interface Mounted {
  win: Window & typeof globalThis;
  html: HTMLElement;
  toggle: HTMLElement;
  /** Fires app.js's IntersectionObserver callback as if `el` had scrolled into the band. */
  intersect: (el: Element) => void;
}

/** A page with two categories, each with subsections, mounted with the real app.js. jsdom has
 * neither `matchMedia` nor `IntersectionObserver`, so both are stubbed: `narrow` is what the
 * drawer media query reports, and the observer callback is captured for `intersect`. */
function mount(options: { narrow?: boolean; stored?: string } = {}): Mounted {
  const html = renderFixturePage({
    markdown: "Intro.\n\n## What changed\n\nMain.\n\n## Tests\n\nTest prose.\n",
    extraCategory: "Intro two.\n\n## Second change\n\nBody.\n",
  });
  let callback: ((entries: unknown[]) => void) | null = null;
  const win = mountWithAppJs(html, {
    prepare(prepWin) {
      if (options.stored !== undefined) {
        prepWin.localStorage.setItem(STORAGE_KEY, options.stored);
      }
      prepWin.matchMedia = (() => ({
        matches: options.narrow ?? false,
        addEventListener() {},
      })) as unknown as typeof prepWin.matchMedia;
      prepWin.IntersectionObserver = class {
        constructor(cb: (entries: unknown[]) => void) {
          callback = cb;
        }
        observe() {}
      } as unknown as typeof prepWin.IntersectionObserver;
    },
  });
  const toggle = win.document.getElementById("toc-toggle");
  if (!toggle) {
    throw new Error("expected #toc-toggle");
  }
  return {
    win,
    html: win.document.documentElement,
    toggle,
    intersect(el) {
      if (!callback) {
        throw new Error("app.js did not create an IntersectionObserver");
      }
      callback([{ isIntersecting: true, target: el }]);
    },
  };
}

describe("TOC fold (app.js under jsdom)", () => {
  it("starts unfolded, and the toggle folds it, updates aria-expanded and persists", () => {
    const { win, html, toggle } = mount();
    expect(html.classList.contains("toc-folded")).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    toggle.click();
    expect(html.classList.contains("toc-folded")).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(win.localStorage.getItem(STORAGE_KEY)).toBe("folded");
    toggle.click();
    expect(html.classList.contains("toc-folded")).toBe(false);
    expect(win.localStorage.getItem(STORAGE_KEY)).toBe("open");
  });

  it("applies a stored folded state on load", () => {
    const { html, toggle } = mount({ stored: "folded" });
    expect(html.classList.contains("toc-folded")).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("on a narrow screen starts folded and folds again when an entry is chosen", () => {
    const { win, html, toggle } = mount({ narrow: true });
    expect(html.classList.contains("toc-folded")).toBe(true);
    toggle.click();
    expect(html.classList.contains("toc-folded")).toBe(false);
    // The drawer state is transient: nothing is written while narrow.
    expect(win.localStorage.getItem(STORAGE_KEY)).toBeNull();
    const link = win.document.querySelector('#toc a[href="#category-1"]');
    (link as HTMLElement).click();
    expect(html.classList.contains("toc-folded")).toBe(true);
  });
});

describe("TOC accordion (app.js under jsdom)", () => {
  it("marks only the category whose subsection is in view as current", () => {
    const { win, intersect } = mount();
    const categories = Array.from(win.document.querySelectorAll("#toc > ul > li"));
    expect(categories).toHaveLength(3);
    intersect(win.document.getElementById("category-1-main-0") as Element);
    expect(categories.map((li) => li.classList.contains("toc-current"))).toEqual([
      false,
      false,
      true,
    ]);
    intersect(win.document.getElementById("category-0-main-0") as Element);
    expect(categories.map((li) => li.classList.contains("toc-current"))).toEqual([
      false,
      true,
      false,
    ]);
  });
});
