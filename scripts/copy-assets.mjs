// tsc only compiles .ts files, so the static rendering assets (CSS/JS/vendored mermaid — see
// src/rendering/assets) need a separate copy step to land next to the compiled JS in dist/,
// where src/rendering/assemble.ts looks for them at runtime when running from a build.
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildHljsBundle } from "./build-hljs-bundle.mjs";

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

// The vendored syntax-highlighting bundle isn't checked into git either (see .gitignore) — it's
// built fresh from the `highlight.js` devDependency by ./build-hljs-bundle.mjs, since that
// package (unlike mermaid) ships no prebuilt browser bundle to copy.
await buildHljsBundle(join(vendorDir, "highlight.min.js"));

// Self-hosted webfonts (see style.css's @font-face rules) — also refreshed here, not checked
// in. Each @fontsource package ships every weight/style/subset as separate variable-font
// woff2 files; only the "wght"-axis (no optical-size axis — smaller file), non-italic, latin
// subset is copied, since that's all this page needs (docs/adr/0004). The OFL requires the
// license file travel with the font, so it's copied alongside each woff2.
const fontsDir = join(vendorDir, "fonts");
await mkdir(fontsDir, { recursive: true });
const FONTS = [
  { pkg: "@fontsource-variable/inter", woff2: "inter-latin-wght-normal.woff2", license: "inter" },
  {
    pkg: "@fontsource-variable/jetbrains-mono",
    woff2: "jetbrains-mono-latin-wght-normal.woff2",
    license: "jetbrains-mono",
  },
];
for (const font of FONTS) {
  const pkgDir = fileURLToPath(new URL(`../node_modules/${font.pkg}/`, import.meta.url));
  await cp(join(pkgDir, "files", font.woff2), join(fontsDir, font.woff2));
  await cp(join(pkgDir, "LICENSE"), join(fontsDir, `${font.license}-LICENSE.txt`));
}

await cp(src, dest, { recursive: true });
