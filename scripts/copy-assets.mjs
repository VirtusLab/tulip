// tsc only compiles .ts files, so the static rendering assets (CSS/JS/vendored mermaid — see
// src/rendering/assets) need a separate copy step to land next to the compiled JS in dist/,
// where src/rendering/assemble.ts looks for them at runtime when running from a build.
import { cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("../src/rendering/assets", import.meta.url));
const dest = fileURLToPath(new URL("../dist/rendering/assets", import.meta.url));

await cp(src, dest, { recursive: true });
