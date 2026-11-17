import { describe, expect, it, vi } from "vitest";
import { mountWithAppJs, NO_ASSETS, PAGE_RUN } from "./page.fixture.js";
import { renderPage } from "./template.js";

function mount(fetchImpl: () => Promise<unknown>) {
  const html = renderPage({
    assets: NO_ASSETS,
    prTitle: "t",
    prDescription: "d",
    prUrl: "https://github.com/a/b/pull/1",
    ...PAGE_RUN,
    fileDiffs: new Map(),
    explanations: [],
    serve: true,
    share: true,
  });
  const fetch = vi.fn(fetchImpl);
  const win = mountWithAppJs(html, {
    prepare(prepWin) {
      prepWin.fetch = fetch as unknown as typeof prepWin.fetch;
    },
  });
  const button = win.document.querySelector(".share-submit") as HTMLButtonElement;
  const status = win.document.querySelector(".share-status") as HTMLElement;
  return { button, status, fetch };
}

describe("the Share button", () => {
  it("posts to /api/share as JSON and links the comment", async () => {
    const { button, status, fetch } = mount(async () => ({
      ok: true,
      json: async () => ({ url: "https://github.com/a/b/pull/1#issuecomment-2" }),
    }));

    button.click();
    expect(button.disabled).toBe(true);
    await vi.waitFor(() => expect(button.disabled).toBe(false));

    expect(fetch).toHaveBeenCalledWith("/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(status.textContent).toBe("Shared ✓ view comment");
    expect(status.querySelector("a")?.getAttribute("href")).toBe(
      "https://github.com/a/b/pull/1#issuecomment-2",
    );
  });

  it.each([
    ["the server answers with an error", async () => ({ ok: false, json: async () => ({}) })],
    [
      "the request fails",
      async () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("shows an error and re-enables the button when %s", async (_, fetchImpl) => {
    const { button, status } = mount(fetchImpl);

    button.click();
    await vi.waitFor(() => expect(button.disabled).toBe(false));

    expect(status.classList.contains("error")).toBe(true);
    expect(status.textContent).toContain("Could not share the page");
  });
});
