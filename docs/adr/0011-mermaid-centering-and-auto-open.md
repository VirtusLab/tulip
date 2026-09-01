# 11. Mermaid centering fix (real fix) and auto-open the rendered page

## Context

Two follow-ups from the author after a real-browser review of a rendered page.

1. ADR 0009's mermaid-centering fix (`main pre.mermaid { text-align: center; }`) does not
   actually center the diagram in a real browser — a diagram narrower than its container still
   sits flush-left inside its bordered block. ADR 0009's own verification note already admitted
   jsdom "has no real layout engine, so it can't report an svg's actual rendered pixel position"
   and fell back to asserting the CSS mechanism (`textAlign === "center"`) instead of the outcome.
   That was the mistake: the mechanism was wrong, and nothing caught it because nothing rendered
   the page for real.
2. The pipeline only logs `file://<path>` after rendering; the author wants the page to open
   automatically.

## 1. Mermaid centering

**Why `text-align: center` doesn't reliably center the svg.** `text-align` only centers
inline-level content within its line box. mermaid's rendered `<svg>` carries `width="100%"` as a
presentation attribute (an author-stylesheet-beatable *hint*, not a real style) plus an inline
`style="max-width: <N>px"` — see `configureSvgSize` in the vendored bundle. An svg element's
own default CSS `display` is browser/UA-dependent and, combined with the width coming from an
attribute rather than a genuine inline style, is not reliably treated as the "narrower-than-
container inline replaced element" case `text-align: center` assumes. In practice this leaves the
svg sized correctly (via `max-width`) but not centered.

**Fix:** `main pre.mermaid { display: flex; justify-content: center; }` (`style.css`). A flex
container blockifies and centers its item on the main axis regardless of the item's own declared
or default `display` — CSS Flexbox's box-generation rules force any flex item's used outer
display to block-level, so this doesn't depend on guessing how the svg's `display` resolves,
unlike `text-align`. `overflow-x: auto` (already on the shared `pre` rule) is untouched, so an
oversized diagram still scrolls inside the block instead of the page. A narrower diagram is
centered because its used width is clamped down by mermaid's own `max-width`; a wider one still
fills the container at `width: 100%` (flex-basis), so the "grow to fill" behavior ADR 0009
established is unaffected either way.

**Verification note — correcting ADR 0009, and an honest caveat.** ADR 0009 claimed the fix was
verified while explicitly relying only on jsdom's CSS engine, which cannot render mermaid's SVG or
report real layout — that is not verification of centering, only of one candidate mechanism
compiling to the expected computed style. This ADR's fix was instead verified against a real,
headless Chrome render (driven directly over the DevTools Protocol — no puppeteer/playwright
dependency in this repo) of a generated page with both a narrow and a deliberately wide mermaid
diagram, measuring the rendered `<svg>`'s bounding-box center against `pre.mermaid`'s content-box
center directly — see the implementation report for the measured numbers (0px deviation for both).
The jsdom test (`layout.test.ts`) is kept only for what it can actually prove: that the CSS rule
(`display: flex; justify-content: center`) is present and that mermaid's own inline `max-width` is
never overridden — not that pixels are centered.

Caveat: the same real-Chrome harness, pointed at the *old* `text-align: center` rule, also
measured 0px deviation — i.e. the specific regression the author reported in their browser could
not be reproduced in headless Chrome 152 during this fix. The likely explanation is a
browser/engine difference in how a percentage-width, no-explicit-height `<svg>` (sized only via
`width="100%"` + inline `max-width`, relying on `viewBox` for its aspect ratio) resolves as
inline-level "shrink-to-fit" content — a class of cross-browser inconsistency with replaced
elements sized this way. This wasn't chased further since only Chrome was available to test
against in this environment. `display: flex` is kept as the fix regardless: it's what the task
specified, it's the spec-guaranteed mechanism (flexbox blockifies every item's outer display,
independent of the item's own resolved `display`), and it's confirmed centered here — so even
without reproducing the original failure, it's strictly not a regression and closes the
browser-dependency `text-align` had.

## 2. Auto-open the rendered page

**Fix:** after `assembleOutput` succeeds, `pipeline/run.ts` spawns the OS "open" command against
the assembled `index.html` path: `open` (macOS), `xdg-open` (Linux), `cmd /c start ""` (Windows).
Kept in the pipeline, not `assemble.ts` — `assemble.ts` stays a pure "write files, return paths"
step; opening a browser is a side effect belonging to orchestration, and keeping it out lets
`assemble.ts`'s existing unit tests stay side-effect-free.

- New `--no-open` flag (`src/cli/args.ts`, mirrors `--verbose`); default is to open.
- The `file://<path>` log line is unconditional — it's the fallback when auto-open is disabled or
  fails, so it always appears regardless.
- The opener is spawned with the path as a plain argv element (`spawn(cmd, [path], ...)` or
  equivalent), never interpolated into a shell string — no injection surface, though the path is
  always our own temp directory anyway.
- A missing opener binary or a failed spawn is logged at debug level and otherwise ignored — never
  fails the run.
- `PipelineDeps` gains an injectable `openInBrowser` dependency (defaults to the real spawn-based
  implementation), so the test suite never actually spawns a browser.

## References

- ADR 0009 (rendering fixes batch 2) — the mermaid-centering attempt this ADR replaces, and the
  general layout/grid rules `pre.mermaid` still lives inside.
- ADR 0004 (page layout) / ADR 0008 (mermaid render verification) — the mermaid pipeline this
  touches only the CSS/display side of, not validation or rendering itself.
