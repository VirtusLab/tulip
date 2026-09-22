(() => {
  var STORAGE_KEY = "tulip-theme";
  var TOC_FOLD_KEY = "tulip-toc-folded";
  // Below this width style.css turns the TOC into a drawer over the content.
  var NARROW_QUERY = "(width < 1100px)";

  function currentTheme() {
    var stored = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch (_e) {
      // localStorage unavailable (e.g. file:// in some browsers) — fall back to system theme.
    }
    if (stored === "light" || stored === "dark") {
      return stored;
    }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme(theme, persist) {
    document.documentElement.setAttribute("data-theme", theme);
    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEY, theme);
      } catch (_e) {
        // ignore — theme just won't persist across reloads
      }
    }
    document.dispatchEvent(new CustomEvent("tulip:theme-change", { detail: { theme: theme } }));
  }

  function setupThemeToggle() {
    applyTheme(currentTheme(), false);
    var button = document.getElementById("theme-toggle");
    if (!button) {
      return;
    }
    button.addEventListener("click", () => {
      var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      applyTheme(next, true);
    });
  }

  function setupToc() {
    var toc = document.getElementById("toc");
    if (!toc) {
      return;
    }
    var links = Array.prototype.slice.call(toc.querySelectorAll("a[href^='#']"));
    var targets = links
      .map((link) => {
        var id = link.getAttribute("href").slice(1);
        var el = document.getElementById(id);
        return el ? { link: link, el: el } : null;
      })
      .filter(Boolean);

    if (targets.length === 0 || !window.IntersectionObserver) {
      return;
    }

    var categories = Array.prototype.slice.call(toc.querySelectorAll(":scope > ul > li"));
    var active = null;
    function setActive(link) {
      if (active) {
        active.classList.remove("active");
      }
      active = link;
      if (active) {
        active.classList.add("active");
      }
      // Accordion (style.css): only the current category lists its subsections.
      var current = active ? active.closest(".toc > ul > li") : null;
      categories.forEach((li) => {
        li.classList.toggle("toc-current", li === current);
      });
    }

    var observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }
          var match = targets.filter((t) => t.el === entry.target)[0];
          if (match) {
            setActive(match.link);
          }
        });
      },
      { rootMargin: "-10% 0px -70% 0px" },
    );

    targets.forEach((t) => {
      observer.observe(t.el);
    });
  }

  // Fold state lives on <html> so style.css can drop the sidebar column (docs/adr/0023). On a
  // narrow screen the TOC is a drawer: closed until opened, closed again by choosing an entry,
  // and never stored — a "folded" saved from a phone would otherwise hide the sidebar on the
  // next wide screen.
  function setupTocFold() {
    var button = document.getElementById("toc-toggle");
    var toc = document.getElementById("toc");
    if (!button || !toc) {
      return;
    }
    var narrow = window.matchMedia ? window.matchMedia(NARROW_QUERY) : null;
    function isNarrow() {
      return Boolean(narrow?.matches);
    }
    function setFolded(folded, persist) {
      document.documentElement.classList.toggle("toc-folded", folded);
      button.setAttribute("aria-expanded", String(!folded));
      if (persist) {
        try {
          localStorage.setItem(TOC_FOLD_KEY, folded ? "folded" : "open");
        } catch (_e) {
          // ignore — the fold state just won't persist across reloads
        }
      }
    }
    function initialFolded() {
      if (isNarrow()) {
        return true;
      }
      try {
        return localStorage.getItem(TOC_FOLD_KEY) === "folded";
      } catch (_e) {
        return false;
      }
    }

    setFolded(initialFolded(), false);
    button.addEventListener("click", () => {
      setFolded(!document.documentElement.classList.contains("toc-folded"), !isNarrow());
    });
    narrow?.addEventListener("change", () => {
      setFolded(initialFolded(), false);
    });
    toc.addEventListener("click", (event) => {
      if (isNarrow() && event.target.closest("a")) {
        setFolded(true, false);
      }
    });
  }

  // A test/docs subsection is a closed <details> (docs/adr/0022). Navigating to it opens it,
  // then scrolls: on load the browser's own scroll ran before this.
  function reveal(target) {
    var folded = target ? target.closest("details") : null;
    if (folded && !folded.open) {
      folded.open = true;
      target.scrollIntoView();
    }
  }

  function revealHashTarget() {
    reveal(document.getElementById(location.hash.slice(1)));
  }

  // The click path reads the link itself: the hash is not yet updated inside the click event,
  // and a click on the already-current hash fires no hashchange at all.
  function setupHashReveal() {
    revealHashTarget();
    window.addEventListener("hashchange", revealHashTarget);
    document.addEventListener("click", (event) => {
      var target = event.target;
      var link = target instanceof Element ? target.closest("a[href^='#']") : null;
      if (link) {
        reveal(document.getElementById(link.getAttribute("href").slice(1)));
      }
    });
  }

  function loadMermaidSources() {
    var el = document.getElementById("tulip-mermaid-sources");
    if (!el) {
      return [];
    }
    try {
      return JSON.parse(el.textContent || "[]");
    } catch (_e) {
      return [];
    }
  }

  // Reads the page's own palette (see style.css's :root custom properties) so mermaid draws
  // diagrams in the same colors/font as the rest of the page instead of one of its stock
  // themes — mermaid's fully-customizable "base" theme takes every color from
  // `themeVariables`. Read live (not cached) so a theme toggle picks up the new values.
  function mermaidThemeVariables() {
    var styles = getComputedStyle(document.documentElement);
    function v(name, fallback) {
      var value = styles.getPropertyValue(name);
      return value ? value.trim() : fallback;
    }
    return {
      background: v("--bg", "#ffffff"),
      mainBkg: v("--code-bg", "#f6f8fa"),
      primaryColor: v("--code-bg", "#f6f8fa"),
      primaryTextColor: v("--fg", "#1f2328"),
      primaryBorderColor: v("--accent", "#6e40c9"),
      secondaryColor: v("--surface", "#f6f7f9"),
      secondaryBorderColor: v("--border", "#d8dee4"),
      tertiaryColor: v("--surface", "#f6f7f9"),
      tertiaryBorderColor: v("--border", "#d8dee4"),
      lineColor: v("--muted", "#57606a"),
      textColor: v("--fg", "#1f2328"),
      nodeTextColor: v("--fg", "#1f2328"),
      clusterBkg: v("--surface", "#f6f7f9"),
      clusterBorder: v("--border", "#d8dee4"),
      edgeLabelBackground: v("--bg", "#ffffff"),
      fontFamily: v("--font-sans", "sans-serif"),
      // Rendered 1:1 (style.css leaves mermaid's natural-width cap in place), so this is the
      // size diagram text actually shows at — the same as the prose around it.
      fontSize: getComputedStyle(document.body).fontSize || "16px",
    };
  }

  // A diagram wider than its block scales down to fit (style.css). Below this fraction of its
  // natural size the text stops being readable, so the svg keeps at least this much and the
  // block scrolls sideways instead.
  var MIN_DIAGRAM_SCALE = 0.7;

  // Mermaid reports a diagram's natural width as an inline `max-width` on the svg it inserts.
  // The wide class is cleared before measuring, so the block is measured at its normal width on
  // every render and a theme toggle can't flip the decision.
  function fitDiagram(node) {
    node.classList.remove("mermaid-wide");
    var svg = node.querySelector("svg");
    var natural = svg ? parseFloat(svg.style.maxWidth) : NaN;
    if (!(natural > 0)) {
      return;
    }
    var floor = Math.round(natural * MIN_DIAGRAM_SCALE);
    svg.style.minWidth = `${floor}px`;
    // The floor would overflow the block: give the diagram the whole column first.
    node.classList.toggle("mermaid-wide", floor > node.clientWidth);
  }

  // Mermaid replaces each `.mermaid` element's content with rendered SVG in place, so a
  // theme change (which needs a full re-render to pick up mermaid's own theme colors) first
  // restores each element's original source from the page-embedded JSON before re-running.
  function setupMermaid() {
    if (!window.mermaid) {
      return;
    }
    var sources = loadMermaidSources();

    function render() {
      var nodes = document.querySelectorAll("pre.mermaid");
      nodes.forEach((node) => {
        var index = Number(node.getAttribute("data-mermaid-index"));
        var source = sources[index];
        if (source !== undefined) {
          node.removeAttribute("data-processed");
          node.textContent = source;
        }
      });
      window.mermaid.initialize({
        startOnLoad: false,
        theme: "base",
        themeVariables: mermaidThemeVariables(),
      });
      // suppressErrors: an invalid diagram renders mermaid's own error placeholder instead of
      // rejecting — without it, an invalid diagram left an unhandled promise rejection.
      window.mermaid
        .run({ nodes: nodes, suppressErrors: true })
        .then(() => nodes.forEach(fitDiagram))
        .catch(() => {});
    }

    render();
    document.addEventListener("tulip:theme-change", render);
  }

  // --- mirrored from snippets.ts: BEGIN --- (must render identical HTML; see the parity test,
  // which evaluates this block on its own in Node — hence escapeHtml inlined here)
  var SNIPPET_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  var EXPAND_STEP = 20;

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (ch) => SNIPPET_ESCAPES[ch]);
  }

  function cellTypeClass(type) {
    return type ? ` type-${escapeHtml(type)}` : "";
  }

  // Rows come from the page-embedded file-content JSON: raw (unescaped) untrusted file text, so
  // every interpolated value is escaped here exactly like the server-rendered rows are.
  function baseCells(row) {
    return (
      '<td class="snippet-line-no side-base' +
      cellTypeClass(row.baseType) +
      '">' +
      (row.baseLine == null ? "" : escapeHtml(row.baseLine)) +
      "</td>" +
      '<td class="snippet-marker side-base' +
      cellTypeClass(row.baseType) +
      '">' +
      (row.baseType === "remove" ? "-" : "") +
      "</td>" +
      '<td class="snippet-cell-base' +
      cellTypeClass(row.baseType) +
      '"><code>' +
      (row.baseText == null ? "" : escapeHtml(row.baseText)) +
      "</code></td>"
    );
  }

  function headCells(row) {
    return (
      '<td class="snippet-line-no side-head' +
      cellTypeClass(row.headType) +
      '">' +
      (row.headLine == null ? "" : escapeHtml(row.headLine)) +
      "</td>" +
      '<td class="snippet-marker side-head' +
      cellTypeClass(row.headType) +
      '">' +
      (row.headType === "add" ? "+" : "") +
      "</td>" +
      '<td class="snippet-cell-head' +
      cellTypeClass(row.headType) +
      '"><code>' +
      (row.headText == null ? "" : escapeHtml(row.headText)) +
      "</code></td>"
    );
  }

  // `paneMode` (default "split") mirrors ./snippets.ts's own parameter — "head-only"/"base-only"
  // for an added/removed file's single-pane rows (see the container's `data-pane-mode`, read by
  // setupSnippetExpansion below), "split" (or omitted) for the two-pane default.
  function renderSnippetRow(row, paneMode) {
    var base = paneMode !== "head-only" ? baseCells(row) : "";
    var head = paneMode !== "base-only" ? headCells(row) : "";
    return `<tr>${base}${head}</tr>`;
  }

  // A gap row is re-rendered here after each partial expansion (see setupSnippetExpansion).
  function renderGapRow(fromRow, toRow, position, paneMode, embeddable) {
    var count = toRow - fromRow + 1;
    var unit = count === 1 ? "line" : "lines";
    var label = `<span class="snippet-gap-label">⋯ ${count} ${unit}</span>`;
    var controls = label;
    if (embeddable && count <= EXPAND_STEP) {
      controls = `<button type="button" class="snippet-gap-btn" data-dir="all">expand ${count} ${unit}</button>`;
    } else if (embeddable) {
      const up =
        position === "bottom"
          ? ""
          : `<button type="button" class="snippet-gap-btn" data-dir="up">↑ ${EXPAND_STEP}</button>`;
      const down =
        position === "top"
          ? ""
          : `<button type="button" class="snippet-gap-btn" data-dir="down">↓ ${EXPAND_STEP}</button>`;
      controls = `${up}${label}${down}`;
    }
    var colspan = paneMode === "split" ? 6 : 3;
    return `<tr class="snippet-gap" data-from-row="${escapeHtml(fromRow)}" data-to-row="${escapeHtml(toRow)}" data-position="${escapeHtml(position)}"><td colspan="${colspan}">${controls}</td></tr>`;
  }
  // --- mirrored from snippets.ts: END ---

  function loadFileData() {
    var el = document.getElementById("tulip-file-data");
    if (!el) {
      return {};
    }
    try {
      return JSON.parse(el.textContent || "{}");
    } catch (_e) {
      return {};
    }
  }

  function renderRows(rows, paneMode) {
    var html = "";
    for (let i = 0; i < rows.length; i++) {
      html += renderSnippetRow(rows[i], paneMode);
    }
    return html;
  }

  // Gap-row expansion (docs/adr/0021). Every control is a `tr.snippet-gap` owning a hidden range
  // [fromRow, toRow] of whole-file row indices. A click reveals up to EXPAND_STEP rows, shrinks
  // the range, and re-renders the row — or removes it once nothing is hidden. Revealed rows come
  // from the page-embedded whole-file data, so a change that isn't part of this block shows as
  // add/remove rows, as expanded context does on GitHub.
  function expandGap(gapRow, rows, paneMode, dir) {
    var fromRow = Number(gapRow.getAttribute("data-from-row"));
    var toRow = Number(gapRow.getAttribute("data-to-row"));
    var position = gapRow.getAttribute("data-position");
    if (!Number.isInteger(fromRow) || !Number.isInteger(toRow)) {
      return;
    }
    // "up" grows the region below the gap upward: it reveals the range's tail and inserts it
    // below this row. "down" grows the region above downward: the range's head, inserted above
    // this row. "all" is a "down" that fits in one step.
    var up = dir === "up";
    var revealFrom = up ? Math.max(fromRow, toRow - EXPAND_STEP + 1) : fromRow;
    var revealTo = up ? toRow : Math.min(toRow, fromRow + EXPAND_STEP - 1);
    var insertAt = up ? "afterend" : "beforebegin";
    gapRow.insertAdjacentHTML(insertAt, renderRows(rows.slice(revealFrom, revealTo + 1), paneMode));
    if (up) {
      toRow = revealFrom - 1;
    } else {
      fromRow = revealTo + 1;
    }
    if (fromRow <= toRow) {
      // Only an embeddable file has buttons, so the re-rendered row is embeddable too.
      gapRow.insertAdjacentHTML(
        "beforebegin",
        renderGapRow(fromRow, toRow, position, paneMode, true),
      );
    }
    gapRow.remove();
  }

  // One delegated listener: gap rows are re-created on every step, so per-button listeners
  // would be lost. Files over the embed cap have no rows here and no buttons.
  function setupSnippetExpansion() {
    var fileData = loadFileData();
    document.addEventListener("click", (event) => {
      var target = event.target;
      var button = target instanceof Element ? target.closest(".snippet-gap-btn") : null;
      if (!button) {
        return;
      }
      var gapRow = button.closest("tr.snippet-gap");
      var container = button.closest(".snippet");
      if (!gapRow || !container) {
        return;
      }
      var path = container.getAttribute("data-path");
      var rows = path ? fileData[path] : undefined;
      if (!rows) {
        return;
      }
      var paneMode = container.getAttribute("data-pane-mode") || "split";
      expandGap(gapRow, rows, paneMode, button.getAttribute("data-dir"));
      highlightSnippetContainer(container);
    });
  }

  // Syntax highlighting. Only highlight.js's own output — which escapes all text — ever reaches
  // innerHTML here (docs/adr/0023, highlight-safety.test.ts, highlight-runs.test.ts).
  // Tokenizing runs on the main thread and its cost grows with input size, so a pathological
  // input is left as plain, already-escaped text. A run spans many lines, hence its larger cap.
  var MAX_HIGHLIGHT_CHARS = 20000;
  var MAX_RUN_HIGHLIGHT_CHARS = 200000;

  function highlightElementSafely(code, lang) {
    if (!window.hljs || !lang || !window.hljs.getLanguage(lang)) {
      return;
    }
    if (code.textContent.length > MAX_HIGHLIGHT_CHARS) {
      return;
    }
    code.classList.add(`language-${lang}`);
    try {
      window.hljs.highlightElement(code);
    } catch (_e) {
      // Leave the (already-safe, escaped) plain text as-is on any highlighter failure.
    }
  }

  // Cuts `hljs.highlight`'s output at each newline into self-contained fragments: spans open at
  // the cut are closed there and re-opened on the next line. highlight.js escapes text, so the
  // only raw `<` in its output belongs to its own span tags.
  function splitHighlightedLines(value) {
    var open = [];
    return value.split("\n").map((line) => {
      var prefix = open.join("");
      for (const [tag] of line.matchAll(/<span[^>]*>|<\/span>/g)) {
        if (tag === "</span>") {
          open.pop();
        } else {
          open.push(tag);
        }
      }
      return prefix + line + "</span>".repeat(open.length);
    });
  }

  // One side's code cells between gap rows, in document order: the side's text is contiguous
  // there. A blank cell (no `type-*` class: this side has no line at that row) is skipped
  // without breaking the run.
  function sideRuns(container, side) {
    var runs = [];
    var run = [];
    container.querySelectorAll("tr").forEach((row) => {
      if (row.classList.contains("snippet-gap")) {
        if (run.length > 0) {
          runs.push(run);
        }
        run = [];
        return;
      }
      var cell = row.querySelector(`.snippet-cell-${side}`);
      var code = cell ? cell.querySelector("code") : null;
      if (code && /(^| )type-/.test(cell.className)) {
        run.push(code);
      }
    });
    if (run.length > 0) {
      runs.push(run);
    }
    return runs;
  }

  // Highlights a run as one text, so a construct spanning lines (a block comment, a template
  // string) keeps its state from cell to cell. Already-highlighted cells are redone with the
  // rest: rows revealed by a gap expansion can change what the rows below them are.
  function highlightRun(codes, lang) {
    // A cell is one line by construction; the HTML parser turns a CRLF file's trailing `\r`
    // into a newline, which would otherwise double the split. Only the trailing one is dropped:
    // a `\r` inside a line also becomes a newline, and then the count check below leaves the
    // run alone rather than silently joining what the cell displays.
    var text = codes.map((code) => code.textContent.replace(/\n$/, "")).join("\n");
    if (text.length > MAX_RUN_HIGHLIGHT_CHARS) {
      return;
    }
    var lines;
    try {
      const result = window.hljs.highlight(text, { language: lang, ignoreIllegals: true });
      lines = splitHighlightedLines(result.value);
    } catch (_e) {
      // Leave the (already-safe, escaped) plain text as-is on any highlighter failure.
      return;
    }
    if (lines.length !== codes.length) {
      return;
    }
    codes.forEach((code, index) => {
      code.innerHTML = lines[index];
      code.classList.add("hljs", `language-${lang}`);
      code.dataset.highlighted = "yes";
    });
  }

  // Highlights a `{{snippet}}` diff block's code cells (see ./snippets.ts), per side and per
  // run, in the language ./snippets.ts guessed from the file path (`data-lang`). A run with no
  // new cell is left alone, so calling this again after a gap expansion (setupSnippetExpansion)
  // only touches the runs that expansion changed.
  function highlightSnippetContainer(container) {
    var lang = container.getAttribute("data-lang");
    if (!window.hljs || !lang || !window.hljs.getLanguage(lang)) {
      return;
    }
    ["base", "head"].forEach((side) => {
      sideRuns(container, side).forEach((codes) => {
        if (codes.some((code) => !code.hasAttribute("data-highlighted"))) {
          highlightRun(codes, lang);
        }
      });
    });
  }

  // Highlights fenced code blocks in prose (LLM-authored markdown outside `{{snippet}}` refs —
  // see ./markdown.ts / ./prose.ts). marked already emits `<code class="language-xxx">` for a
  // fenced block tagged with a language (e.g. ```ts); blocks with no tag are left as plain,
  // already-escaped text rather than guessed at.
  function highlightProseCode() {
    document
      .querySelectorAll('main pre > code[class*="language-"]:not([data-highlighted])')
      .forEach((code) => {
        var match = /language-(\S+)/.exec(code.className);
        highlightElementSafely(code, match?.[1]);
      });
  }

  function setupHighlighting() {
    if (!window.hljs) {
      return;
    }
    highlightProseCode();
    document.querySelectorAll(".snippet[data-lang]").forEach(highlightSnippetContainer);
  }

  // Serve mode only (docs/adr/0019): each `.review-box` (./template.ts's renderReviewBox) posts a
  // per-category PR comment to the local server's `/api/comment`. A no-op on the static page,
  // which renders no boxes. Deliberately placed AFTER setupHighlighting and OUTSIDE the mirrored
  // block above (see the marker there).
  function setupReviewBoxes() {
    document.querySelectorAll(".review-box").forEach((form) => {
      var textarea = form.querySelector(".review-text");
      var button = form.querySelector(".review-submit");
      var status = form.querySelector(".review-status");
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        status.classList.remove("error");
        var categoryIndex = Number(form.getAttribute("data-category-index"));
        var text = textarea.value;
        if (!text.trim()) {
          status.textContent = "Write a comment before posting.";
          return;
        }
        button.disabled = true;
        status.textContent = "Posting…";
        fetch("/api/comment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ categoryIndex: categoryIndex, text: text }),
        })
          .then((response) => {
            if (!response.ok) {
              throw new Error("request failed");
            }
            return response.json();
          })
          .then((data) => {
            status.textContent = "Posted ✓ ";
            // Build the link element-wise — never assign untrusted text to innerHTML.
            var link = document.createElement("a");
            link.href = data.url;
            link.textContent = "view comment";
            link.target = "_blank";
            link.rel = "noopener";
            status.appendChild(link);
            textarea.value = "";
          })
          .catch(() => {
            status.textContent = "Could not post the comment. Try again.";
            status.classList.add("error");
          })
          .finally(() => {
            button.disabled = false;
          });
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    setupThemeToggle();
    setupToc();
    setupTocFold();
    setupHashReveal();
    setupMermaid();
    setupSnippetExpansion();
    setupHighlighting();
    setupReviewBoxes();
  });
})();
