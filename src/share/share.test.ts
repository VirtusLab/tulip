import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ForgeAdapter, PreviewPublisher, PrRef, PublishedPreview } from "../forge/types.js";
import { forgeFor } from "../forge-registry/registry.js";
import { pageRunMetaTags } from "../rendering/page-meta.js";
import { signPage } from "./page-signature.js";
import { memoizeUntilSuccess, shareCommand, shareRun } from "./share.js";

const HEAD_SHA = "c".repeat(40);
const GENERATED_AT = new Date("2026-10-19T14:32:00.000Z");
const PUBLISHED: PublishedPreview = {
  commentUrl: "https://github.com/octo/widgets/pull/42#issuecomment-1",
  previewUrl: "https://github.com/octo/widgets/blob/abc/tulip-pr-42-ccccccc.html",
  warnings: ["couldn't retire the earlier preview comment"],
};

let dir: string;
let pagePath: string;
let page: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tulip-share-test-"));
  pagePath = join(dir, "index.html");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeRun(prUrl = "https://github.com/octo/widgets/pull/42") {
  const tags = pageRunMetaTags({ prUrl, headSha: HEAD_SHA, generatedAt: GENERATED_AT });
  page = await signPage(`<!doctype html><head>${tags}</head>`, join(dir, "share-key"));
  await writeFile(pagePath, page);
}

function deps(publisher: PreviewPublisher | undefined) {
  const logger = { info: vi.fn(), debug: vi.fn() };
  return {
    logger,
    forgeFor: (pr: PrRef): ForgeAdapter => {
      const { previewPublisher: _, ...adapter } = forgeFor(pr);
      return { ...adapter, ...(publisher && { previewPublisher: publisher }) };
    },
  };
}

function fakePublisher() {
  const publish = vi.fn(async () => PUBLISHED);
  const publisher: PreviewPublisher = {
    prepare: vi.fn(async () => ({ notice: "the preview goes to your fork", publish })),
  };
  return { publisher, publish };
}

describe("shareRun", () => {
  it("publishes the run's page for its commit, and logs the outcome", async () => {
    await writeRun();
    const { publisher, publish } = fakePublisher();
    const shareDeps = deps(publisher);

    await shareRun(pagePath, join(dir, "share-key"), shareDeps);

    expect(publish).toHaveBeenCalledWith(
      { page, headSha: HEAD_SHA, generatedAt: GENERATED_AT },
      undefined,
    );
    const lines = shareDeps.logger.info.mock.calls.map((call) => String(call[0]));
    expect(lines).toEqual([
      "sharing octo/widgets#42 at ccccccc...",
      "the preview goes to your fork",
      "warning: couldn't retire the earlier preview comment",
      `preview file: ${PUBLISHED.previewUrl}`,
      "preview shared: https://github.com/octo/widgets/pull/42#issuecomment-1",
    ]);
  });

  it("refuses a page changed after Tulip rendered it, before preparing anything", async () => {
    await writeRun();
    await writeFile(pagePath, `${page}<script>steal()</script>`);
    const { publisher } = fakePublisher();

    await expect(shareRun(pagePath, join(dir, "share-key"), deps(publisher))).rejects.toThrow(
      "isn't a page signed by Tulip",
    );
    expect(publisher.prepare).not.toHaveBeenCalled();
  });

  it("refuses a run whose forge can't share", async () => {
    await writeRun("https://gitlab.com/group/project/-/merge_requests/7");

    await expect(shareRun(pagePath, join(dir, "share-key"), deps(undefined))).rejects.toThrow(
      "sharing isn't supported for gitlab URLs",
    );
  });
});

describe("shareCommand", () => {
  it("quotes a directory the shell would split or expand", () => {
    expect(shareCommand("/tmp/tulip-render-abc")).toBe("tulip share /tmp/tulip-render-abc");
    expect(shareCommand("/Users/Jo Doe/run")).toBe("tulip share '/Users/Jo Doe/run'");
    expect(shareCommand("/tmp/it's")).toBe("tulip share '/tmp/it'\\''s'");
  });
});

describe("memoizeUntilSuccess", () => {
  it("runs concurrent calls once and keeps the result", async () => {
    const attempt = vi.fn(async () => "done");
    const once = memoizeUntilSuccess(attempt);

    const results = await Promise.all([once(), once()]);
    await once();

    expect(results).toEqual(["done", "done"]);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("retries after a failure", async () => {
    const attempt = vi.fn().mockRejectedValueOnce(new Error("flaky")).mockResolvedValue("done");
    const once = memoizeUntilSuccess(attempt as () => Promise<string>);

    await expect(once()).rejects.toThrow("flaky");
    await expect(once()).resolves.toBe("done");
    expect(attempt).toHaveBeenCalledTimes(2);
  });
});
