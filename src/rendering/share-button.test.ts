import { describe, expect, it, vi } from "vitest";
import { mountWithAppJs } from "./page.fixture.js";
import { renderPage } from "./template.js";

function mount(fetchImpl: () => Promise<unknown>) {
  const html = renderPage({
    prTitle: "t",
    prDescription: "d",
    prUrl: "https://github.com/a/b/pull/1",
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

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("the Share button", () => {
  it("posts to /api/share as JSON and links the comment", async () => {
    const { button, status, fetch } = mount(async () => ({
      ok: true,
      json: async () => ({ url: "https://github.com/a/b/pull/1#issuecomment-2" }),
    }));

    button.click();
    expect(button.disabled).toBe(true);
    await settle();

    expect(fetch).toHaveBeenCalledWith("/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(status.textContent).toBe("Shared ✓ view comment");
    expect(status.querySelector("a")?.getAttribute("href")).toBe(
      "https://github.com/a/b/pull/1#issuecomment-2",
    );
    expect(button.disabled).toBe(false);
  });

  it("shows an error and re-enables the button when sharing fails", async () => {
    const { button, status } = mount(async () => ({ ok: false, json: async () => ({}) }));

    button.click();
    await settle();

    expect(status.classList.contains("error")).toBe(true);
    expect(status.textContent).toContain("Could not share the page");
    expect(button.disabled).toBe(false);
  });
});
