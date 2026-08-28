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

**Typography and palette: ~~system font stacks~~ self-hosted webfonts (see the "self-hosted
webfonts" amendment below) over a system-font fallback stack, GitHub-derived colors.** A
strong system stack (`ui-sans-serif, -apple-system, ... "Inter", ...` /
`ui-monospace, "SF Mono", "Cascadia Code", ...`) looks good on every major OS this tool
runs on; it's now the *fallback* tier behind the vendored fonts rather than the whole
story. The palette (light and dark) intentionally follows
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
- ~~**Vendoring a webfont.** Rejected — adds real weight and complexity (subsetting,
  license, embedding) for a marginal gain over a well-chosen system stack, whose main
  targets (macOS/Windows/Linux desktops) already ship strong UI fonts.~~ **Superseded** —
  see "Amendment: self-hosted webfonts" below. A user decision (backed by research into
  current OSS options) judged the visual/consistency gain worth it, and the actual
  vendored weight turned out much smaller than "adds real weight" assumed (see the
  amendment for the number).

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

## Amendment: review fixes

A review of the above found the vendored-bundle test silently no-opped on a fresh clone,
a real accessibility/semantic bug in the syntax-token colors, and two unstyled markdown
elements. Fixed in the same unit:

- **`highlight-safety.test.ts` silently skipped when the vendored bundle was missing** (so
  `pnpm test` alone, without `pnpm build` first, reported green without ever running the
  real highlighter against the XSS payload). Fixed by building the bundle on demand —
  but *not* in that test's own `beforeAll`, as first tried: esbuild's own environment
  self-check (`new TextEncoder().encode("") instanceof Uint8Array`) fails under this
  file's `@vitest-environment jsdom` globals, since jsdom's `Uint8Array` isn't the same
  constructor esbuild's `TextEncoder` output is checked against. Moved the on-demand build
  into `vitest.config.ts`'s `globalSetup` (`scripts/vitest-global-setup.mjs`), which runs
  once in a plain Node process before any test file's environment is set up — the same
  `buildHljsBundle` `copy-assets.mjs` uses, just invoked from a different, jsdom-free
  phase. Verified by moving the built bundle aside and running only that test file: it now
  builds the bundle and runs for real, rather than skipping.
- **Syntax-token colors reused the diff +/- colors** (`.hljs-string`/`.hljs-addition`/
  `.hljs-attribute` on `--add-fg`, `.hljs-attr`/`.hljs-variable`/`.hljs-deletion` on
  `--remove-fg`). Since these tokens render inside diff cells too, this both measured
  under WCAG AA on the opposite-polarity background (e.g. light `--add-fg` on
  `--remove-bg` = 4.43:1) and read as a false signal (a green string token on a removed
  line). Fixed with two new tokens, decoupled from the diff colors entirely and chosen to
  clear 4.5:1 against `--code-bg`, `--add-bg` *and* `--remove-bg` in both themes:
  `--token-string` (teal) and `--token-attr` (magenta) — picked from hues that don't
  overlap red/green, so a token can never itself be misread as an add/remove signal.
- **GFM tables and images in prose were unstyled.** An unstyled `<table>` looks broken;
  an `<img>` with no `max-width` could overflow the prose column and force the page body
  to scroll horizontally, which the layout decision above explicitly rules out. Added
  `main table:not(.snippet-table)` (border/padding/header background, `:not` to leave the
  diff table's own rules alone) and `main img { max-width: 100%; height: auto; }`.
- **Minor:** `h4` now completes the heading scale (was narrowed by the generic prose
  selector but otherwise unstyled); `blockquote` gets a left border, padding and muted
  color.
- **Robustness:** the client highlighter now skips a code cell whose text exceeds
  `MAX_HIGHLIGHT_CHARS` (20,000 characters) — leaves it as the already-escaped plain text
  it already was rather than running highlight.js's tokenizer over it, since that cost
  scales with input size and runs on the main thread. A pathological single line (a
  minified/generated file caught in a diff) shouldn't be able to jank the local viewer.
- Guarded against future drift with a test asserting `language.ts`'s
  `SUPPORTED_LANGUAGES` (every language name it can produce) is exactly the set
  `scripts/hljs-entry.mjs` registers — a mismatch either way silently breaks highlighting
  for one language or ships dead weight in the vendored bundle.

## Amendment: self-hosted webfonts

### Context

The original decision above used only system font stacks, explicitly rejecting a
vendored webfont for weight/complexity reasons (see the struck-through bullet in
"Alternatives considered"). A follow-up user decision, backed by research into current
open-source options, judged a real (not system-substitute) typeface worth it for a
reviewer-facing tool people look at for extended periods — **Inter** for prose and
**JetBrains Mono** for code, both widely regarded, actively maintained, SIL OFL 1.1
("free and open... may be shared, modified and redistributed") open-source fonts
designed for exactly these roles (Inter: UI/text legibility at small sizes; JetBrains
Mono: designed specifically for reading code, with generous letter spacing and
disambiguated similar characters like `0`/`O`/`l`/`1`).

### Decision

Self-host both, vendored the same way as `mermaid`/`highlight.js` — copied from a
devDependency at build time, not committed, so a fresh clone still produces a complete
page after `pnpm install && pnpm build`. Specifically:

- **`@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono`** (new
  devDependencies) — the variable-font builds, since a single variable-weight file
  covers every weight this page uses (400 body text, 600-650 headings/summaries, 700
  bold) more cheaply than shipping several static-weight files.
- **Latin subset, weight-axis-only file, non-italic.** Each package ships every
  subset (cyrillic, greek, vietnamese, ...) and axis combination (weight-only vs.
  weight+optical-size) as separate woff2 files; `scripts/copy-assets.mjs` copies just
  `*-latin-wght-normal.woff2` from each — the smallest single file that covers this
  page's actual content (English prose, code, GitHub URLs) and every weight it uses.
  Skipping the optical-size axis (Inter's `standard`/`opsz` files) saves ~24KB on Inter
  alone (48KB vs. 72KB) for a page that never varies optical size. No italic file is
  vendored either — markdown `*emphasis*` still renders in the browser's synthesized
  (auto-slanted) oblique, a common and unremarkable tradeoff, rather than doubling the
  font payload for the occasional `<em>`.
- **Hand-written `@font-face` rules in `style.css`**, not a copy of `@fontsource`'s own
  CSS (which references its own multi-subset file layout) — one `@font-face` per font,
  `src: url("vendor/fonts/....woff2") format("woff2-variations")`, `font-display: swap`
  (avoid invisible text while the local file loads — a font `<link rel=preload>` isn't
  worth it for a same-origin `file://` load), local path relative to `style.css` itself.
  `--font-sans`/`--font-mono` gain `"Inter Variable"`/`"JetBrains Mono Variable"` (the
  `@font-face` family names, matching `@fontsource`'s own convention so they can't
  collide with a same-named static font already installed on the reader's system) as
  the *first* entry, ahead of the existing system stack — the system fonts are now a
  fallback for the brief `font-display: swap` flash and for any environment that
  somehow can't load a local woff2, not the primary choice.
- **Ligatures left at the font's default** — no `font-variant-ligatures`/
  `font-feature-settings` override. JetBrains Mono's ligatures (e.g. `!=`, `=>`) are a
  reasonable default for a code-reading tool; nothing here disables or forces them.
- **Licensing.** OFL 1.1 requires the license text travel with the font. Each
  package's `LICENSE` file is copied alongside its woff2 into
  `assets/vendor/fonts/{inter,jetbrains-mono}-LICENSE.txt` — not referenced by the page
  (fonts aren't "sold... by themselves" here, bundled with the tool's own output), but
  present in the shipped output directory per the license's terms.

### Consequences

- **Added page weight: ~87KB** (`inter-latin-wght-normal.woff2` 48,256 bytes +
  `jetbrains-mono-latin-wght-normal.woff2` 40,404 bytes = 88,660 bytes), i.e. what a
  browser actually fetches to render the page — comfortably inside "a few hundred KB".
  The two `LICENSE.txt` files (~9KB combined) add to the shipped output directory but
  are never fetched by the page itself.
- New devDependencies: `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono`.
- `scripts/copy-assets.mjs` gains a font-copying step (mirrors the mermaid/highlight.js
  vendoring exactly: copy from `node_modules`, into `assets/vendor/fonts/`, gitignored).
- Still zero network references: `@font-face src` is a relative local path, verified by
  both a static content test (`assets.test.ts`) and a real generated page executed in
  `jsdom` with `runScripts: "dangerously"` (no console/jsdom errors, `--font-sans`
  resolves with `"Inter Variable"` first).
