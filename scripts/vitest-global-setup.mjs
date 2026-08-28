// Vitest "globalSetup": runs once before the whole test run, in a plain Node process — not
// inside any individual test file's environment. That matters here: esbuild (which
// buildHljsBundle uses) breaks under jsdom's globals (its own
// `new TextEncoder().encode("") instanceof Uint8Array` self-check fails across realms), so
// building the vendored highlight.js bundle on demand can't live inside
// src/rendering/highlight-safety.test.ts's own `@vitest-environment jsdom` beforeAll. Doing it
// here instead means `pnpm test` alone (without `pnpm build` first) still builds the bundle and
// exercises the real highlighter in that test, rather than it silently no-opping when the
// bundle is missing.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildHljsBundle } from "./build-hljs-bundle.mjs";

const BUNDLE_PATH = fileURLToPath(
  new URL("../src/rendering/assets/vendor/highlight.min.js", import.meta.url),
);

export default async function setup() {
  if (!existsSync(BUNDLE_PATH)) {
    await buildHljsBundle(BUNDLE_PATH);
  }
}
