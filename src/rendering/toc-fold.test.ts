import { describe, expect, it } from "vitest";
import { mountWithAppJs, renderFixturePage } from "./page.fixture.js";

const STORAGE_KEY = "tulip-toc-folded";

interface Mounted {
  win: Window & typeof globalThis;
  html: HTMLElement;
  toggle: HTMLElement;
  /** Fires app.js's IntersectionObserver callback as if `el` had scrolled into the band. */
  intersect: (el: Element) => void;
  /** Flips what the drawer media query reports and notifies app.js's `change` listeners. */
  setNarrow: (narrow: boolean) => void;
}

/** A page with two categories, each with subsections, mounted with the real app.js. jsdom has
 * neither `matchMedia` nor `IntersectionObserver`, so both are stubbed: `narrow` is what the
 * drawer media query reports (`setNarrow` changes it later), and the observer callback is
 * captured for `intersect`. `observer: false` leaves IntersectionObserver undefined. */
function mount(options: { narrow?: boolean; stored?: string; observer?: boolean } = {}): Mounted {
  const html = renderFixturePage({
    markdown: "Intro.\n\n## What changed\n\nMain.\n\n## Tests\n\nTest prose.\n",
    extraCategory: "Intro two.\n\n## Second change\n\nBody.\n",
  });
  let callback: ((entries: unknown[]) => void) | null = null;
  const query = {
    matches: options.narrow ?? false,
    listeners: [] as (() => void)[],
    addEventListener(_type: string, listener: () => void) {
      this.listeners.push(listener);
    },
  };
  const win = mountWithAppJs(html, {
    prepare(prepWin) {
      if (options.stored !== undefined) {
        prepWin.localStorage.setItem(STORAGE_KEY, options.stored);
      }
      prepWin.matchMedia = (() => query) as unknown as typeof prepWin.matchMedia;
      if (options.observer !== false) {
        prepWin.IntersectionObserver = class {
          constructor(cb: (entries: unknown[]) => void) {
            callback = cb;
          }
          observe() {}
        } as unknown as typeof prepWin.IntersectionObserver;
      }
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
    setNarrow(narrow) {
      query.matches = narrow;
      for (const listener of query.listeners) {
        listener();
      }
    },
  };
}

function isFolded(html: HTMLElement): boolean {
  return html.classList.contains("toc-folded");
}

describe("TOC fold (app.js under jsdom)", () => {
  it("starts unfolded, and the toggle folds it, updates aria-expanded and persists", () => {
    const { win, html, toggle } = mount();
    expect(isFolded(html)).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    toggle.click();
    expect(isFolded(html)).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(win.localStorage.getItem(STORAGE_KEY)).toBe("folded");
    toggle.click();
    expect(isFolded(html)).toBe(false);
    expect(win.localStorage.getItem(STORAGE_KEY)).toBe("open");
  });

  it("applies a stored folded state on load", () => {
    const { html, toggle } = mount({ stored: "folded" });
    expect(isFolded(html)).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("on a narrow screen starts folded and folds again when an entry is chosen", () => {
    const { win, html, toggle } = mount({ narrow: true });
    expect(isFolded(html)).toBe(true);
    toggle.click();
    expect(isFolded(html)).toBe(false);
    // The drawer state is transient: nothing is written while narrow.
    expect(win.localStorage.getItem(STORAGE_KEY)).toBeNull();
    const link = win.document.querySelector('#toc a[href="#category-1"]');
    (link as HTMLElement).click();
    expect(isFolded(html)).toBe(true);
  });

  it("folds when the screen turns narrow and restores the stored preference when it widens", () => {
    const { html, setNarrow } = mount({ stored: "open" });
    expect(isFolded(html)).toBe(false);
    setNarrow(true);
    expect(isFolded(html)).toBe(true);
    setNarrow(false);
    expect(isFolded(html)).toBe(false);

    const folded = mount({ stored: "folded" });
    folded.setNarrow(true);
    folded.toggle.click();
    expect(isFolded(folded.html)).toBe(false);
    folded.setNarrow(false);
    expect(isFolded(folded.html)).toBe(true);
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

  it("marks no category without an IntersectionObserver, so the CSS keeps every subsection visible", () => {
    const { win } = mount({ observer: false });
    expect(win.document.querySelector("#toc .toc-current")).toBeNull();
    expect(win.document.querySelectorAll("#toc .toc-children").length).toBeGreaterThan(0);
  });
});
