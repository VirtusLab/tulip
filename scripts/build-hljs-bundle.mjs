// Bundles ./hljs-entry.mjs into a single self-contained, minified browser script — the npm
// `highlight.js` package has no prebuilt browser bundle to copy (unlike mermaid's
// dist/mermaid.min.js), so it's built locally with esbuild instead. Shared by
// ./copy-assets.mjs (real build output) and src/rendering/*.test.ts (which build it on demand
// if it isn't already there, so `pnpm test` works without requiring `pnpm build` first).

import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ENTRY = fileURLToPath(new URL("./hljs-entry.mjs", import.meta.url));

/** Builds the vendored highlight.js bundle to `outFile` (an absolute path). */
export async function buildHljsBundle(outFile) {
  await build({
    entryPoints: [ENTRY],
    outfile: outFile,
    bundle: true,
    minify: true,
    format: "iife",
    target: "es2020",
    logLevel: "silent",
  });
}
