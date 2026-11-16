# 30. Single-file output

## Context

The page was `index.html` plus an `assets/` directory: `style.css`, `app.js`, the vendored mermaid
and highlight.js bundles, and two woff2 fonts. To share a page, someone had to zip the directory
or host it. `index.html` alone showed an unstyled page with no diagrams.

## Decision

- **One file.** The output directory holds only `index.html`, with every asset embedded, so the
  page can be sent as one file. There is no flag and no linked mode.
- **Embedding.** `src/rendering/inline-assets.ts` reads the assets. Fonts become base64 data URIs
  inside the stylesheet, the stylesheet goes in a `<style>` element, and each script goes in its
  own inline `<script>`, in page order: mermaid, highlight.js, app.js.
- **Script escaping.** `</script` would close the element early. `<!--` can put the HTML
  tokenizer into its script-escape states; with every `<!--` removed it never enters them, so
  `<script` needs no escaping. `</script` becomes `<\/script` and `<!--` becomes `<\x21--`, which
  read the same inside a JS string or regex literal. The escape goes after the `<`: an earlier
  `\x3C` for the `<` broke when a backslash came before it (`"\<!--"`, `/\<!--/`). A test compiles
  each escaped bundle: a match outside a literal would not compile.
- **CR and NUL.** The HTML parser turns CRLF and CR into LF before the browser hashes a script,
  so they are converted first. It turns NUL into U+FFFD, which would break the hash, so a NUL in a
  script is an error.
- **Font licenses.** The OFL requires its text to travel with the fonts. A comment at the top of
  the stylesheet holds each font's copyright line and each license text once.
- **CSP.** Nothing is linked, so there is no `'self'` except `connect-src` (`--serve` posts to the
  local server). `script-src` lists the SHA-256 hash of each inline script, `style-src` is
  `'unsafe-inline'`, and `img-src` and `font-src` are `data:`. The `'self'` in `img-src` went too:
  no local file other than `index.html` exists to load.
- **Timing.** Inline scripts can't be `defer`red. They sit after all page content, and `app.js`
  waits for `DOMContentLoaded`, so they run at the same point as before.

## Consequences

- The page is a few MB, mostly mermaid.
- Loading fonts and mermaid from a CDN instead was rejected. The page must fetch nothing external:
  a private PR's page shouldn't reveal that it was opened, it must work offline, and the CSP
  forbids it. Fonts are only about 3% of the page anyway.
