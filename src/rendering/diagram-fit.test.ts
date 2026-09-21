import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { renderPage } from "./template.js";

// `import.meta.dirname`, not `new URL(..., import.meta.url)` — see highlight-safety.test.ts.
const APP_JS = readFileSync(`${import.meta.dirname}/assets/app.js`, "utf8");

/** Mounts a page with one diagram in its own JSDOM window, with a stand-in `mermaid` that
 * renders every placeholder as an svg of `naturalWidth` (Mermaid reports natural width as an
 * inline `max-width`), then runs the real app.js. Resolves once app.js's post-render step has
 * had a chance to run. */
async function mountDiagram(naturalWidth: number): Promise<Element> {
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
  const win = dom.window as unknown as Window & { mermaid?: unknown };
  win.mermaid = {
    initialize() {},
    async run({ nodes }: { nodes: Iterable<Element> }) {
      for (const node of nodes) {
        node.innerHTML = `<svg width="100%" style="max-width: ${naturalWidth}px;"></svg>`;
      }
    },
  };
  dom.window.eval(APP_JS);
  dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const pre = dom.window.document.querySelector("pre.mermaid");
  if (!pre) {
    throw new Error("expected a diagram placeholder");
  }
  return pre;
}

describe("diagram fit (app.js under jsdom)", () => {
  it("floors a wide diagram at 70% of its natural width and widens its block", async () => {
    const pre = await mountDiagram(2000);
    expect(pre.querySelector("svg")?.getAttribute("style")).toContain("min-width: 1400px");
    expect(pre.classList.contains("mermaid-wide")).toBe(true);
  });

  it("floors a diagram that fits the block too (narrow screens), without widening it", async () => {
    const pre = await mountDiagram(500);
    expect(pre.querySelector("svg")?.getAttribute("style")).toContain("min-width: 350px");
    expect(pre.classList.contains("mermaid-wide")).toBe(false);
  });
});
