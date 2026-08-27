import { parse } from "node-html-parser";
import { describe, expect, it } from "vitest";
import type { CategoryExplanation } from "../explanations/types.js";
import { renderPage } from "./template.js";

function explanation(overrides: Partial<CategoryExplanation> = {}): CategoryExplanation {
  return {
    category: { name: "Auth", description: "Authentication changes" },
    markdown: "## Production code\n\nDoes the thing.\n\n## Test code\n\nTests the thing.\n",
    ...overrides,
  };
}

describe("renderPage", () => {
  it("renders the PR header with title, description and link", () => {
    const html = renderPage({
      prTitle: "Add retry logic",
      prDescription: "Retries flaky requests.",
      prUrl: "https://github.com/acme/widgets/pull/7",
      explanations: [],
    });
    const root = parse(html);
    expect(root.querySelector("h1")?.text).toBe("Add retry logic");
    expect(root.querySelector(".pr-description")?.text).toContain("Retries flaky requests.");
    expect(root.querySelector(".pr-link a")?.getAttribute("href")).toBe(
      "https://github.com/acme/widgets/pull/7",
    );
  });

  it("renders one section per category, in given order", () => {
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      explanations: [
        explanation({ category: { name: "First", description: "" } }),
        explanation({ category: { name: "Second", description: "" } }),
      ],
    });
    const root = parse(html);
    const sections = root.querySelectorAll(".category");
    expect(sections).toHaveLength(2);
    expect(sections[0]?.querySelector("h2")?.text).toBe("First");
    expect(sections[1]?.querySelector("h2")?.text).toBe("Second");
    expect(sections[0]?.id).toBe("category-0");
    expect(sections[1]?.id).toBe("category-1");
  });

  it("splits a category into Production/Test subsections when the markdown has them", () => {
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      explanations: [explanation()],
    });
    const root = parse(html);
    const production = root.querySelector("#category-0-production");
    const test = root.querySelector("#category-0-test");
    expect(production?.querySelector("h3")?.text).toBe("Production code");
    expect(production?.text).toContain("Does the thing.");
    expect(test?.querySelector("h3")?.text).toBe("Test code");
    expect(test?.text).toContain("Tests the thing.");
  });

  it("does not force subsections when the markdown has none", () => {
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      explanations: [explanation({ markdown: "Just some prose, no headings." })],
    });
    const root = parse(html);
    expect(root.querySelector("#category-0-production")).toBeNull();
    expect(root.querySelector("#category-0-test")).toBeNull();
    expect(root.querySelector("#category-0")?.text).toContain("Just some prose, no headings.");
  });

  it("includes a TOC entry per category and per present subsection", () => {
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      explanations: [
        explanation({ category: { name: "Auth", description: "" } }),
        explanation({
          category: { name: "Logging", description: "" },
          markdown: "Just prose.",
        }),
      ],
    });
    const root = parse(html);
    const toc = root.querySelector("#toc");
    expect(toc).not.toBeNull();
    const links = toc?.querySelectorAll("a").map((a) => a.getAttribute("href")) ?? [];
    expect(links).toEqual([
      "#category-0",
      "#category-0-production",
      "#category-0-test",
      "#category-1",
    ]);
  });

  it("turns mermaid fences into diagram placeholders and embeds their sources", () => {
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      explanations: [
        explanation({
          markdown: "## Production code\n\n```mermaid\ngraph TD\nA --> B\n```\n",
        }),
      ],
    });
    const root = parse(html);
    const pre = root.querySelector("pre.mermaid");
    expect(pre?.getAttribute("data-mermaid-index")).toBe("0");
    const sourcesScript = root.querySelector("#tulip-mermaid-sources");
    expect(sourcesScript).not.toBeNull();
    const sources = JSON.parse(sourcesScript?.text ?? "[]");
    expect(sources).toEqual(["graph TD\nA --> B"]);
  });

  it("carries theme-toggle and asset hooks with no network references", () => {
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      explanations: [],
    });
    expect(html).toContain('id="theme-toggle"');
    expect(html).toContain('href="assets/style.css"');
    expect(html).toContain('src="assets/vendor/mermaid.min.js"');
    expect(html).toContain('src="assets/app.js"');
    expect(html).not.toMatch(/https?:\/\/(?!github\.com)/);
    expect(html).not.toContain("cdn.");
  });
});
