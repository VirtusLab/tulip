# 33. Mermaid from a CDN by default

## Context

The page embeds every asset (ADR 0030), so it is about 5.9 MB, of which mermaid is 5.5 MB.
Shared pages (ADR 0032) are stored on hidden refs that nothing prunes, one per preview.

## Decision

- By default the page loads mermaid from jsDelivr, at the version the build vendored:
  `https://cdn.jsdelivr.net/npm/mermaid@<version>/dist/mermaid.min.js`. The build records the
  version in `vendor/mermaid.version`. The page is then about 350 KB plus its content.
- The `<script>` is `async`, so a slow or unreachable CDN doesn't hold up `app.js`, which
  renders the diagrams once mermaid arrives.
- It carries an SRI `integrity` hash of the vendored bundle. jsDelivr serves the npm package's
  files unchanged, so the hash matches without fetching anything at build time, and a browser
  refuses any other content.
- The CSP's `script-src` allows that exact URL, not the host, so markup on the page can't load
  any other file from jsDelivr.
- `--offline` embeds mermaid as before, for pages that must work without network or reveal
  nothing about being opened.
- highlight.js, the fonts, `style.css` and `app.js` stay embedded in both modes. Together they
  are about 0.3 MB; loading them too would add more ways for the page to break for little gain.
- If mermaid doesn't load (no network, blocked CDN, wrong hash), the page shows each diagram's
  source as text.

## Consequences

- Opening the page contacts jsDelivr, which learns the reader's IP and that some page loaded
  mermaid, but nothing about the PR.
- Without network, or behind a proxy that blocks jsDelivr, diagrams show as source text.
- A page relies on jsDelivr keeping that mermaid version available.
