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
      window.mermaid.run({ nodes: nodes });
    }

    render();
    document.addEventListener("tulip:theme-change", render);
  }

  document.addEventListener("DOMContentLoaded", () => {
    setupThemeToggle();
    setupToc();
    setupMermaid();
  });
})();
