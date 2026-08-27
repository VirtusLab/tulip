(() => {
  var STORAGE_KEY = "tulip-theme";

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

    var active = null;
    function setActive(link) {
      if (active) {
        active.classList.remove("active");
      }
      active = link;
      if (active) {
        active.classList.add("active");
      }
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

  function mermaidTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "default";
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
      window.mermaid.initialize({ startOnLoad: false, theme: mermaidTheme() });
      // suppressErrors: an invalid diagram renders mermaid's own error placeholder instead of
      // rejecting — without it, an invalid diagram left an unhandled promise rejection.
      window.mermaid.run({ nodes: nodes, suppressErrors: true }).catch(() => {});
    }

    render();
    document.addEventListener("tulip:theme-change", render);
  }

  var SNIPPET_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (ch) => SNIPPET_ESCAPES[ch]);
  }

  function cellTypeClass(type) {
    return type ? ` type-${type}` : "";
  }

  // Mirrors ./snippets.ts's exported `renderSnippetRow` (the server-side row renderer) line for
  // line — used to insert newly-revealed context rows when expand-up/expand-down is clicked
  // (see setupSnippetExpansion). Row text comes from the page-embedded file-content JSON, which
  // is raw (unescaped) untrusted file content, so it must be escaped here exactly like the
  // server-rendered rows are. The two must stay byte-identical; keep them in sync by hand and
  // see snippets.test.ts's "byte-identical" parity test, which evaluates this copy in Node
  // (no browser) and asserts it matches the TS one on the same input.
  function renderSnippetRow(row) {
    return (
      "<tr>" +
      '<td class="snippet-line-no side-base' +
      cellTypeClass(row.baseType) +
      '">' +
      (row.baseLine == null ? "" : row.baseLine) +
      "</td>" +
      '<td class="snippet-cell-base' +
      cellTypeClass(row.baseType) +
      '"><code>' +
      (row.baseText == null ? "" : escapeHtml(row.baseText)) +
      "</code></td>" +
      '<td class="snippet-line-no side-head' +
      cellTypeClass(row.headType) +
      '">' +
      (row.headLine == null ? "" : row.headLine) +
      "</td>" +
      '<td class="snippet-cell-head' +
      cellTypeClass(row.headType) +
      '"><code>' +
      (row.headText == null ? "" : escapeHtml(row.headText)) +
      "</code></td>" +
      "</tr>"
    );
  }

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

  var CONTEXT_STEP = 20;

  function expandUp(container, rows, currentStart) {
    var newStart = Math.max(0, currentStart - CONTEXT_STEP);
    var html = "";
    for (let i = newStart; i < currentStart; i++) {
      html += renderSnippetRow(rows[i]);
    }
    var tbody = container.querySelector(".snippet-table tbody");
    if (tbody) {
      tbody.insertAdjacentHTML("afterbegin", html);
    }
    container.setAttribute("data-start-index", String(newStart));
    return newStart === 0;
  }

  function expandDown(container, rows, currentEnd) {
    var newEnd = Math.min(rows.length - 1, currentEnd + CONTEXT_STEP);
    var html = "";
    for (let i = currentEnd + 1; i <= newEnd; i++) {
      html += renderSnippetRow(rows[i]);
    }
    var tbody = container.querySelector(".snippet-table tbody");
    if (tbody) {
      tbody.insertAdjacentHTML("beforeend", html);
    }
    container.setAttribute("data-end-index", String(newEnd));
    return newEnd === rows.length - 1;
  }

  // Github-style context expansion (task 7.3): each button reveals more surrounding lines from
  // the page-embedded per-file row data (see ./file-diffs.ts) without a server round-trip.
  // Buttons only exist for files under the embed-size cap — see ./snippets.ts.
  function setupSnippetExpansion() {
    var fileData = loadFileData();
    document.querySelectorAll(".snippet-expand").forEach((button) => {
      button.addEventListener("click", () => {
        var container = button.closest(".snippet");
        if (!container) {
          return;
        }
        var path = container.getAttribute("data-path");
        var rows = path ? fileData[path] : undefined;
        if (!rows) {
          return;
        }
        var dir = button.getAttribute("data-dir");
        var reachedEnd =
          dir === "up"
            ? expandUp(container, rows, Number(container.getAttribute("data-start-index")))
            : expandDown(container, rows, Number(container.getAttribute("data-end-index")));
        if (reachedEnd) {
          button.remove();
        }
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    setupThemeToggle();
    setupToc();
    setupMermaid();
    setupSnippetExpansion();
  });
})();
