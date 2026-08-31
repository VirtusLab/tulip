import { JSDOM } from "jsdom";

/**
 * Headless mermaid diagram validation, with fidelity to the browser renderer (see ./mermaid.ts,
 * ./assets/app.js): imports the same `mermaid` package version the vendored browser bundle is
 * built from (scripts/copy-assets.mjs copies it straight from this npm package), and calls its
 * own `parse()` — the exact syntax check the client runs before drawing. A "valid" result here is
 * meaningful only because it's the same parser the page actually uses (see docs/adr/0008).
 */

export interface MermaidValidationResult {
  valid: boolean;
  /** Mermaid's own parse error message. Present only when `valid` is false — fed verbatim to the
   * LLM fix prompt (see ../explanations/mermaid-verify.ts) and to warning logs. */
  error?: string;
}

/**
 * mermaid's parser pulls in DOMPurify, which constructs itself — capturing whatever `window` it
 * finds — at DOMPurify's own *module-evaluation* time, not on first use. A plain, ordinary
 * `import mermaid from "mermaid"` at the top of this file would have Node evaluate mermaid's
 * whole dependency graph (dompurify included) *before* any of this module's own top-level code
 * runs (ES module evaluation order: imports evaluate first, depth-first, regardless of where the
 * `import` statement sits in the file) — so installing a jsdom window afterward, even at this
 * module's own top level, is too late. DOMPurify ends up built without a real `window`, which
 * leaves it missing `addHook` and makes every label-sanitizing diagram (i.e. almost every real
 * one — `A[Start]`, `B{Decision}`, ...) fail with "DOMPurify.addHook is not a function", not
 * just genuinely-invalid ones (see docs/adr/0008's amendment; confirmed on the built `dist`
 * output, not just under a test environment).
 *
 * Fixed by never statically importing "mermaid": the jsdom window/document is installed first,
 * as this module's own first top-level statement, and only then is "mermaid" (and transitively
 * dompurify) *dynamically* imported — a dynamic `import()` runs exactly where it's written, not
 * hoisted like a static one. A jsdom-based vitest test environment (e.g.
 * ../rendering/highlight-safety.test.ts) already provides `window`/`document` before any test
 * file's own code (imports included) runs, so this only installs its own when neither exists —
 * never clobbers a real or test DOM.
 */
if (typeof document === "undefined") {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    SVGElement: dom.window.SVGElement,
  });
}

const mermaid = (await import("mermaid")).default;
// Defaults — theme/colors are irrelevant to `parse()`, which only checks syntax.
mermaid.initialize({ startOnLoad: false });

// mermaid.parse() shares process-wide parser/DB state across calls; serialized so concurrent
// validations (one per category explained in parallel — see ../explanations/orchestrate.ts)
// can't interleave against it.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(run: () => Promise<T>): Promise<T> {
  const result = queue.then(run, run);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * Validates one mermaid diagram's source (the text inside a ```mermaid fence — see
 * ./mermaid.ts's `findMermaidFences`) exactly as the browser will: same mermaid version, same
 * `parse()` call, so a `valid: true` result means the page will actually render it.
 */
export async function validateMermaidDiagram(source: string): Promise<MermaidValidationResult> {
  return serialized(async () => {
    try {
      await mermaid.parse(source);
      return { valid: true };
    } catch (error) {
      return { valid: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
