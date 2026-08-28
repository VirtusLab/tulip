# 4. Page layout rework and vendored syntax highlighting

## Context

The rendered page (task 7.1-7.3) works but is plain: diff/snippet blocks share the same
~78ch column as prose, code has no syntax highlighting, and the palette is a minimal
gray/blue scheme. Diffs are the page's main content — cramming them into prose width
makes long lines wrap awkwardly and wastes the rest of the viewport. Mermaid diagrams use
mermaid's stock "default"/"dark" themes, which don't match the page's own colors.

The page is opened via `file://` and must stay fully self-contained (spec: no network
references), matching how `assets/vendor/mermaid.min.js` is already handled: copied from
the `mermaid` devDependency by `scripts/copy-assets.mjs`, gitignored, and excluded from
biome. Diff/file content is attacker-controlled (a malicious PR); every existing renderer
path already HTML-escapes it (`escapeHtml` in `./escape.ts`, mirrored server/client in
`./snippets.ts`/`./assets/app.js`) and template.test.ts/snippets.test.ts carry XSS
regression tests for that.

## Decision

**Syntax highlighting: vendor highlight.js, applied client-side to already-escaped text.**
The npm `highlight.js` package (unlike `mermaid`) ships no prebuilt browser bundle, only
the ESM/CJS library and per-language modules meant to be bundled by the consumer. A new
entry point (`scripts/hljs-entry.mjs`) registers only the ~34 languages
`src/rendering/language.ts` maps extensions to (smaller than highlight.js's own
"all languages" build) and attaches the result as `window.hljs`. `scripts/copy-assets.mjs`
bundles it with `esbuild` (already a transitive dependency of the toolchain, now a direct
one) into `assets/vendor/highlight.min.js` — same gitignored/biome-excluded/rebuilt-every-
build treatment as `mermaid.min.js`, ~155KB minified.

Language is guessed from the file extension only (`languageForPath`, a fixed lookup table
— never from file content, so it can't be steered by attacker-controlled text), recorded
as `data-lang` on each `.snippet` container. The client (`highlightSnippetContainer` in
`assets/app.js`) adds a `language-<lang>` class and calls highlight.js's own
**`highlightElement(el)`** — the safe API: it reads the element's already-escaped
`textContent` (the browser has already unescaped entities back to the raw string, exactly
as `escapeHtml` intended it to be read) and rewrites the element's markup itself,
re-escaping everything it emits. Nothing in this change ever assigns raw/untrusted text to
`innerHTML` directly; `./renderSnippetRow` (server) and its app.js mirror are untouched.
Prose fenced code blocks (marked's default `<pre><code class="language-xxx">` for a tagged
fence) get the same treatment; an untagged fence is left as plain escaped text rather than
guessed at. Unrecognized/no extension likewise skips highlighting rather than guessing.
Verified against the real vendored bundle in a jsdom test
(`highlight-safety.test.ts`) and against a full generated page executed in jsdom
(`</script>`/`<img onerror>` payloads highlighted, never becoming real elements).

Expand-up/down (client-inserted rows) calls the same `highlightSnippetContainer`, scoped
by `:not([data-highlighted])` (highlight.js's own marker) so only the newly-inserted rows
are touched — idempotent, no need to track which DOM nodes were just added.

**Layout: `main` goes full width; prose elements each get their own centered measure.**
Rather than a wrapper-based "breakout" (constrain a narrow parent, break specific children
out via negative margins/`100vw`) — fragile under `file://` since `100vw` doesn't account
for scrollbar width and can itself cause the horizontal overflow the spec forbids — `main`
simply drops its old `max-width: 78ch` and spans up to a generous cap
(`--page-max-width: 1500px`). Individual prose-producing elements (`p`, `ul`, `ol`,
`blockquote`, `h1`-`h4`, the PR link, category descriptions) get
`max-width: var(--prose-measure) /* 72ch */; margin-inline: auto` instead of one shared
wrapper; since they all share the same measure, their edges still line up as one visual
column. `.snippet` and fenced prose code get no such constraint, so they use the full
width. Only `.snippet-scroll` (wrapping the diff table) and `pre` get `overflow-x: auto`;
nothing sets it on `body`.

**Typography and palette: system font stacks, GitHub-derived colors.** No vendored
webfont — a strong system stack (`ui-sans-serif, -apple-system, ... "Inter", ...` /
`ui-monospace, "SF Mono", "Cascadia Code", ...`) looks good on every major OS this tool
runs on and adds zero asset weight. The palette (light and dark) intentionally follows
GitHub's own diff/link colors: this page's audience already reads GitHub diffs daily, so
add/remove/link hues carry existing muscle memory. `--code-font-size` (0.8125rem) is
smaller than prose (16px body). highlight.js's token classes (`.hljs-keyword`,
`.hljs-string`, ...) are themed against this page's own CSS custom properties rather than
one of highlight.js's bundled theme stylesheets — one cohesive palette, and the toggle
needs no re-highlight since it's plain CSS.

**Mermaid: `theme: "base"` with `themeVariables` read from the page's own CSS custom
properties** (`getComputedStyle` at render time), replacing the old
`theme: mermaidTheme() /* "default" | "dark" */`. Re-rendered on `tulip:theme-change`
exactly as before — diagrams now inherit the same colors/font as the rest of the page in
both themes, in the same code path that already restores+reruns on toggle.

## Alternatives considered

- **Server-side highlighting** (e.g. a Node highlighter run during `renderPage`, baking
  highlighted spans into the static HTML). Rejected: it would need to run over
  attacker-controlled file content at build time with the same escaping discipline as
  `escapeHtml`, doubles the code paths that must stay XSS-safe (build-time and the
  client-side expand-up/down insertion still needs its own client-side highlighter
  regardless), and highlight.js's own recommended integration is exactly the client-side
  `highlightElement` pattern used here.
- **`100vw`/negative-margin "breakout" for `.snippet`**, keeping `main` narrow. Rejected
  for the horizontal-scrollbar-width gotcha noted above, and because it's strictly more
  code than just widening `main` and narrowing prose elements individually.
- **Vendoring a webfont.** Rejected — adds real weight and complexity (subsetting,
  license, embedding) for a marginal gain over a well-chosen system stack, whose main
  targets (macOS/Windows/Linux desktops) already ship strong UI fonts.

## Consequences

- New devDependencies: `highlight.js` (bundled, not run in Node), `esbuild` (now direct —
  bundles the highlight.js entry point; was already pulled in transitively). New vendored,
  gitignored, biome-excluded asset: `assets/vendor/highlight.min.js`, rebuilt every
  `pnpm build` alongside `mermaid.min.js` — a fresh clone still produces a complete,
  self-contained page after `pnpm install && pnpm build`.
- `src/rendering/language.ts` is new, small, and easy to extend (add an entry to both its
  lookup table and `scripts/hljs-entry.mjs`'s registered-language list).
- `.snippet-table`'s `table-layout: fixed` and `white-space: pre-wrap` are replaced with
  natural layout + `white-space: pre` so a long line grows the table past its container,
  which is what lets `.snippet-scroll` actually produce a horizontal scrollbar instead of
  wrapping (as before) or silently overflowing.
- `tsconfig.json` gains the `"DOM"` lib (needed only by the new jsdom-based safety test;
  harmless for the rest of the Node/CLI codebase).
- Existing server/client `renderSnippetRow` parity (and its test) is untouched — language
  info rides on the `.snippet` container, not per-row, so highlighting needed no changes
  to the row renderer or its byte-identical mirror.

## Implementation plan

1. `scripts/hljs-entry.mjs` + `scripts/build-hljs-bundle.mjs`: entry point registering the
   curated language set; `esbuild`-based bundler function shared by `copy-assets.mjs` and
   tests. Add `highlight.js`/`esbuild` devDependencies; wire into `copy-assets.mjs`;
   gitignore the built bundle.
2. `src/rendering/language.ts` (+ test): extension/filename → highlight.js language name.
3. `src/rendering/snippets.ts` (+ test): `data-lang` on `.snippet`; wrap the table in
   `.snippet-scroll` for horizontal scrolling.
4. `src/rendering/template.ts` (+ test): load `assets/vendor/highlight.min.js`.
5. `src/rendering/assets/app.js`: `highlightElementSafely`/`highlightSnippetContainer`/
   `highlightProseCode`/`setupHighlighting`, wired into the initial `DOMContentLoaded` and
   into `setupSnippetExpansion`'s click handler; mermaid `themeVariables` read from CSS
   custom properties, replacing the old default/dark theme switch.
6. `src/rendering/assets/style.css`: palette (light/dark), typography, full-width
   layout, highlight.js theme classes, TOC/spacing polish.
7. `tsconfig.json`: add `"DOM"` lib for the new jsdom-based test.
8. Tests: `language.test.ts`, `assets.test.ts` (static CSS/JS content checks),
   `highlight-safety.test.ts` (jsdom, real vendored bundle, XSS-inertness), plus additions
   to `snippets.test.ts`/`template.test.ts`.
9. `pnpm build && pnpm test && pnpm lint` green before each commit; one commit per step
   above, grouped where a step is too small to stand alone.
10. Manual verification: render a fixture page end-to-end (real `renderPage` +
    `assembleOutput`) and execute it in `jsdom` with `runScripts: "dangerously"` to confirm
    highlighting/mermaid/theme wiring runs with no console errors and that injected
    `<script>`/`<img onerror>` diff content stays inert in the real generated page — not
    just in the unit tests.
