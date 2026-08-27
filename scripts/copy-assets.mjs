// tsc only compiles .ts files, so the static rendering assets (CSS/JS/vendored mermaid — see
// src/rendering/assets) need a separate copy step to land next to the compiled JS in dist/,
// where src/rendering/assemble.ts looks for them at runtime when running from a build.
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("../src/rendering/assets", import.meta.url));
const dest = fileURLToPath(new URL("../dist/rendering/assets", import.meta.url));

// The vendored mermaid bundle isn't checked into git (see .gitignore) — refresh it here from
// the installed npm package, rather than hand-copying it, so it can never drift from the
// `mermaid` devDependency in package.json.
const mermaidSrc = fileURLToPath(
  new URL("../node_modules/mermaid/dist/mermaid.min.js", import.meta.url),
);
const vendorDir = join(src, "vendor");
await mkdir(vendorDir, { recursive: true });
await cp(mermaidSrc, join(vendorDir, "mermaid.min.js"));

await cp(src, dest, { recursive: true });
