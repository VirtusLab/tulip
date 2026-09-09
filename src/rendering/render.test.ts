import { describe, expect, it, vi } from "vitest";
import { serializeSnippetRef } from "../explanations/markup.js";
import type { CategoryExplanation } from "../explanations/types.js";
import { renderExplanations } from "./render.js";

function explanation(markdown: string): CategoryExplanation {
  return { category: { id: "c1", name: "Auth", description: "", attention: "normal" }, markdown };
}

describe("renderExplanations", () => {
  it("resolves every referenced file via the checkout and renders it into the page", async () => {
    const ref = serializeSnippetRef({
      path: "src/a.ts",
      head: { start: 1, end: 1 },
      unfold: true,
    });
    const checkout = {
      getFileAtBase: vi.fn(async () => "a\n"),
      getFileAtHead: vi.fn(async () => "a\n"),
    };
    let capturedPage = "";

    const result = await renderExplanations(
      {
        prTitle: "Add feature",
        prDescription: "desc",
        prUrl: "https://github.com/a/b/pull/1",
        explanations: [explanation(`## Production code\n\n${ref}\n`)],
      },
      {
        checkout,
        mkdtemp: async () => "/tmp/tulip-render-1",
        writeFile: async (_path, content) => {
          capturedPage = content;
        },
        copyDir: async () => {},
        assetsDir: "/fake/assets",
        logger: { info: vi.fn(), debug: vi.fn() },
      },
    );

    expect(checkout.getFileAtBase).toHaveBeenCalledWith("src/a.ts");
    expect(checkout.getFileAtHead).toHaveBeenCalledWith("src/a.ts");
    expect(capturedPage).toContain("Add feature");
    expect(capturedPage).toContain('class="snippet"');
    expect(result.indexPath).toBe("/tmp/tulip-render-1/index.html");
  });

  it("fetches base content from the renamed-from path for a renamed-with-changes file", async () => {
    const ref = serializeSnippetRef({
      path: "new/name.ts",
      base: { start: 1, end: 1 },
      unfold: true,
    });
    const checkout = {
      getFileAtBase: vi.fn(async (path: string) => (path === "old/name.ts" ? "old\n" : undefined)),
      getFileAtHead: vi.fn(async (path: string) => (path === "new/name.ts" ? "new\n" : undefined)),
    };

    await renderExplanations(
      {
        prTitle: "t",
        prDescription: "d",
        prUrl: "https://github.com/a/b/pull/1",
        explanations: [explanation(`## Production code\n\n${ref}\n`)],
        renamedFrom: new Map([["new/name.ts", "old/name.ts"]]),
      },
      {
        checkout,
        mkdtemp: async () => "/tmp/tulip-render-rename",
        writeFile: async () => {},
        copyDir: async () => {},
        assetsDir: "/fake/assets",
        logger: { info: vi.fn(), debug: vi.fn() },
      },
    );

    expect(checkout.getFileAtBase).toHaveBeenCalledWith("old/name.ts");
    expect(checkout.getFileAtHead).toHaveBeenCalledWith("new/name.ts");
  });

  it("renders a single head-only pane for an added file, per the fileStatuses map", async () => {
    const ref = serializeSnippetRef({
      path: "src/new.ts",
      head: { start: 1, end: 1 },
      unfold: true,
    });
    const checkout = {
      getFileAtBase: vi.fn(async () => undefined),
      getFileAtHead: vi.fn(async () => "line\n"),
    };
    let capturedPage = "";

    await renderExplanations(
      {
        prTitle: "t",
        prDescription: "d",
        prUrl: "https://github.com/a/b/pull/1",
        explanations: [explanation(`## Production code\n\n${ref}\n`)],
        fileStatuses: new Map([["src/new.ts", "added"]]),
      },
      {
        checkout,
        mkdtemp: async () => "/tmp/tulip-render-added",
        writeFile: async (_path, content) => {
          capturedPage = content;
        },
        copyDir: async () => {},
        assetsDir: "/fake/assets",
        logger: { info: vi.fn(), debug: vi.fn() },
      },
    );

    expect(capturedPage).toContain('data-pane-mode="head-only"');
    expect(capturedPage).not.toContain("snippet-cell-base");
  });

  it("dedupes repeated references to the same file into a single checkout read", async () => {
    const refA = serializeSnippetRef({
      path: "src/a.ts",
      head: { start: 1, end: 1 },
      unfold: true,
    });
    const refB = serializeSnippetRef({
      path: "src/a.ts",
      head: { start: 2, end: 2 },
      unfold: true,
    });
    const checkout = {
      getFileAtBase: vi.fn(async () => "a\nb\n"),
      getFileAtHead: vi.fn(async () => "a\nb\n"),
    };

    await renderExplanations(
      {
        prTitle: "t",
        prDescription: "d",
        prUrl: "https://github.com/a/b/pull/1",
        explanations: [explanation(`${refA}\n\n${refB}\n`)],
      },
      {
        checkout,
        mkdtemp: async () => "/tmp/tulip-render-2",
        writeFile: async () => {},
        copyDir: async () => {},
        assetsDir: "/fake/assets",
        logger: { info: vi.fn(), debug: vi.fn() },
      },
    );

    expect(checkout.getFileAtBase).toHaveBeenCalledTimes(1);
  });

  it("still assembles a page with no snippet references (no checkout calls)", async () => {
    const checkout = {
      getFileAtBase: vi.fn(async () => undefined),
      getFileAtHead: vi.fn(async () => undefined),
    };

    const result = await renderExplanations(
      {
        prTitle: "t",
        prDescription: "d",
        prUrl: "https://github.com/a/b/pull/1",
        explanations: [explanation("Just prose, no markers.")],
      },
      {
        checkout,
        mkdtemp: async () => "/tmp/tulip-render-3",
        writeFile: async () => {},
        copyDir: async () => {},
        assetsDir: "/fake/assets",
        logger: { info: vi.fn(), debug: vi.fn() },
      },
    );

    expect(checkout.getFileAtBase).not.toHaveBeenCalled();
    expect(result.dir).toBe("/tmp/tulip-render-3");
  });

  it("renders the injected build info into the page footer, without touching the real dist/build-info.json", async () => {
    const checkout = {
      getFileAtBase: vi.fn(async () => undefined),
      getFileAtHead: vi.fn(async () => undefined),
    };
    const getBuildInfo = vi.fn(() => ({
      version: "9.9.9",
      commitSha: "cafefeed",
      buildDate: "2026-01-01T00:00:00.000Z",
    }));
    let capturedPage = "";

    await renderExplanations(
      {
        prTitle: "t",
        prDescription: "d",
        prUrl: "https://github.com/a/b/pull/1",
        explanations: [explanation("Just prose, no markers.")],
      },
      {
        checkout,
        mkdtemp: async () => "/tmp/tulip-render-version",
        writeFile: async (_path, content) => {
          capturedPage = content;
        },
        copyDir: async () => {},
        assetsDir: "/fake/assets",
        logger: { info: vi.fn(), debug: vi.fn() },
        getBuildInfo,
      },
    );

    expect(getBuildInfo).toHaveBeenCalled();
    expect(capturedPage).toContain(
      "Generated by Tulip 9.9.9 (cafefeed, built 2026-01-01T00:00:00.000Z)",
    );
  });

  it("falls back to the real dev build-info line when no getBuildInfo override is given", async () => {
    const checkout = {
      getFileAtBase: vi.fn(async () => undefined),
      getFileAtHead: vi.fn(async () => undefined),
    };
    let capturedPage = "";

    await renderExplanations(
      {
        prTitle: "t",
        prDescription: "d",
        prUrl: "https://github.com/a/b/pull/1",
        explanations: [explanation("Just prose, no markers.")],
      },
      {
        checkout,
        mkdtemp: async () => "/tmp/tulip-render-devfallback",
        writeFile: async (_path, content) => {
          capturedPage = content;
        },
        copyDir: async () => {},
        assetsDir: "/fake/assets",
        logger: { info: vi.fn(), debug: vi.fn() },
      },
    );

    // Running from source (not a built dist/), so getBuildInfo's own fallback kicks in — see
    // src/version.ts's dev-fallback behavior and formatVersion's "(dev)" formatting for it.
    expect(capturedPage).toMatch(/Generated by Tulip [\d.]+ \(dev\)/);
  });
});
