# 30. Single-file output

## Context

The page is `index.html` plus an `assets/` directory: `style.css`, `app.js`, the vendored mermaid
and highlight.js bundles, and two woff2 fonts. To share a page, someone has to zip the directory
or host it. Passing on `index.html` alone gives an unstyled page with no diagrams.

## Decision

- **Flag.** `--single-file` writes one `index.html` with every asset embedded, and copies no
  `assets/` directory. The default output is unchanged.
- **Embedding.** `src/rendering/inline-assets.ts` reads the assets. Fonts become base64 data URIs
  inside the stylesheet, the stylesheet goes in a `<style>` element, and each script goes in its
  own inline `<script>`, in the same order as the linked ones.
- **Script escaping.** Both vendored bundles contain `<!--` inside string literals, which can push
  the HTML tokenizer into its script-escape states. Each `<` that starts `<!--`, `<script` or
  `</script` becomes `\x3C`, which is the same character inside a JS string or regex literal. A
  test compiles each escaped bundle: a match outside a literal would not compile.
- **CSP.** The policy stays as strict as the linked page. `script-src` lists the SHA-256 hash of
  each inline script instead of allowing `'unsafe-inline'`, and `font-src` adds `data:`.
- **Timing.** Inline scripts can't be `defer`red. They sit after all page content, and `app.js`
  waits for `DOMContentLoaded`, so they run at the same point as before.

## Consequences

- The page is about 3.7 MB, mostly mermaid. The linked page loads the same bytes, just as
  separate files.
- The font license files (OFL) aren't copied alongside a single-file page. Whether the embedded
  fonts need them there is an open question.
