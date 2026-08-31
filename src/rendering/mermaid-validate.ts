import { JSDOM } from "jsdom";
import mermaid from "mermaid";

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

let mermaidReady: Promise<void> | undefined;

/**
 * mermaid's parser pulls in DOMPurify, which requires a `window` to construct — absent in plain
 * Node, where this runs during the pipeline (unlike a jsdom-based vitest test environment, e.g.
 * ../rendering/highlight-safety.test.ts, which already provides one). Installs a minimal jsdom
 * window/document only when neither exists, so it never clobbers a real or test DOM; otherwise a
 * one-time setup shared by every validation call in the process. `mermaid.initialize` uses
 * defaults — theme/colors are irrelevant to `parse()`, which only checks syntax.
 */
function ensureMermaid(): Promise<void> {
  if (!mermaidReady) {
    mermaidReady = Promise.resolve().then(() => {
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
      mermaid.initialize({ startOnLoad: false });
    });
  }
  return mermaidReady;
}

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
  await ensureMermaid();
  return serialized(async () => {
    try {
      await mermaid.parse(source);
      return { valid: true };
    } catch (error) {
      return { valid: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
