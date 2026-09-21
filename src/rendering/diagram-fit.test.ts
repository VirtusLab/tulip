import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { renderPage } from "./template.js";

// `import.meta.dirname`, not `new URL(..., import.meta.url)` — see highlight-safety.test.ts.
const APP_JS = readFileSync(`${import.meta.dirname}/assets/app.js`, "utf8");

interface Mounted {
  pre: Element;
  /** Re-renders as a theme change does, with the stand-in Mermaid now reporting `naturalWidth`. */
  rerender(naturalWidth: number | undefined): Promise<void>;
}

/** Mounts a page with one diagram in its own JSDOM window, with a stand-in `mermaid` that
 * renders every placeholder as an svg reporting `naturalWidth` the way Mermaid does (an inline
 * `max-width`; `undefined` renders none), then runs the real app.js. jsdom has no layout, so the
 * block's width is stubbed to `blockWidth`. */
async function mountDiagram(naturalWidth: number | undefined, blockWidth = 900): Promise<Mounted> {
  const html = renderPage({
    prTitle: "t",
    prDescription: "d",
    prUrl: "https://github.com/a/b/pull/1",
    fileDiffs: new Map(),
    explanations: [
      {
        category: { id: "c1", name: "C", description: "d", attention: "normal" },
        markdown: "Intro.\n\n```mermaid\ngraph LR\nA-->B\n```\n\n## Production code\n\nBody.\n",
      },
    ],
  });
  const dom = new JSDOM(html, { url: "http://localhost/", runScripts: "outside-only" });
  let width = naturalWidth;
  const win = dom.window as unknown as Window & { mermaid?: unknown };
  win.mermaid = {
    initialize() {},
    async run({ nodes }: { nodes: Iterable<Element> }) {
      for (const node of nodes) {
        node.innerHTML =
          width === undefined
            ? '<svg width="100%"></svg>'
            : `<svg width="100%" style="max-width: ${width}px;"></svg>`;
      }
    },
  };
  const pre = dom.window.document.querySelector("pre.mermaid");
  if (!pre) {
    throw new Error("expected a diagram placeholder");
  }
  Object.defineProperty(pre, "clientWidth", { value: blockWidth });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  dom.window.eval(APP_JS);
  dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  await settle();
  return {
    pre,
    async rerender(next) {
      width = next;
      dom.window.document.dispatchEvent(new dom.window.Event("tulip:theme-change"));
      await settle();
    },
  };
}

const svgStyle = (pre: Element) => pre.querySelector("svg")?.getAttribute("style") ?? "";

describe("diagram fit (app.js under jsdom)", () => {
  it("floors a diagram at 70% of its natural width and widens its block when the floor overflows", async () => {
    const { pre } = await mountDiagram(2000);
    expect(svgStyle(pre)).toContain("min-width: 1400px");
    expect(pre.classList.contains("mermaid-wide")).toBe(true);
  });

  it("floors a diagram whose floor fits the block without widening it", async () => {
    const { pre } = await mountDiagram(1000);
    expect(svgStyle(pre)).toContain("min-width: 700px");
    expect(pre.classList.contains("mermaid-wide")).toBe(false);
  });

  it("re-fits on a theme change, removing the wide class when no longer needed", async () => {
    const mounted = await mountDiagram(2000);
    await mounted.rerender(500);
    expect(svgStyle(mounted.pre)).toContain("min-width: 350px");
    expect(mounted.pre.classList.contains("mermaid-wide")).toBe(false);
  });

  it("leaves an svg without a natural width alone", async () => {
    const mounted = await mountDiagram(2000);
    await mounted.rerender(undefined);
    expect(svgStyle(mounted.pre)).not.toContain("min-width");
    expect(mounted.pre.classList.contains("mermaid-wide")).toBe(false);
  });
});
