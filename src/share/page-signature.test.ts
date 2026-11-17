import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderFixturePage } from "../rendering/page.fixture.js";
import {
  type PageRun,
  pageRunMetaTags,
  SIGNATURE_LENGTH,
  UNSIGNED,
} from "../rendering/page-meta.js";
import { readSignedPage, signPage } from "./page-signature.js";
import { sign } from "./signing.js";

const RUN: PageRun = {
  prUrl: "https://github.com/octo/widgets/pull/42",
  headSha: "c".repeat(40),
  generatedAt: new Date("2026-10-19T14:32:00.000Z"),
};
const EVIL_URL = "https://github.com/evil/repo/pull/1";

function page(body = "<p>hi</p>", run: PageRun = RUN): string {
  return `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n${pageRunMetaTags(run)}\n<title>t</title>\n</head>\n<body>${body}</body>\n</html>\n`;
}

let dir: string;
let keyPath: string;
let pagePath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tulip-page-"));
  keyPath = join(dir, "keys", "share-key");
  pagePath = join(dir, "index.html");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeSigned(content = page(), key = keyPath): Promise<string> {
  const signed = await signPage(content, key);
  await writeFile(pagePath, signed);
  return signed;
}

describe("readSignedPage", () => {
  it.each([
    ["a path", () => pagePath],
    ["a file:// URL", () => pathToFileURL(pagePath).href],
  ])("reads back a page this user signed, from %s", async (_, location) => {
    const signed = await writeSigned();

    const run = await readSignedPage(location(), keyPath);

    expect(run).toEqual({
      pr: { forge: "github", host: "github.com", repoPath: "octo/widgets", number: 42 },
      preview: { page: signed, headSha: RUN.headSha, generatedAt: RUN.generatedAt },
    });
    expect(signed).not.toContain(UNSIGNED);
    expect(signed.length).toBe(page().length);
  });

  it.each([
    ["a changed byte", (signed: string) => signed.replace("<p>hi</p>", "<p>hI</p>")],
    ["another PR URL", (signed: string) => signed.replace(RUN.prUrl, EVIL_URL)],
    ["the placeholder signature", () => page()],
    ["no signature", (signed: string) => signed.replace(/<meta name="tulip-signature"[^>]*>/, "")],
    [
      "a signature only in the body",
      (signed: string) => {
        const tag = /<meta name="tulip-signature"[^>]*>/.exec(signed)?.[0] as string;
        return signed.replace(tag, "").replace("<p>hi</p>", tag);
      },
    ],
  ])("refuses a page with %s", async (_, tamper) => {
    await writeFile(pagePath, tamper(await signPage(page(), keyPath)));

    await expect(readSignedPage(pagePath, keyPath)).rejects.toThrow(
      "isn't a page signed by Tulip for this user, or changed since",
    );
  });

  it("refuses a page signed with someone else's key", async () => {
    await writeSigned(page(), join(dir, "their-key"));

    await expect(readSignedPage(pagePath, keyPath)).rejects.toThrow("isn't a page signed by Tulip");
  });

  it("ignores tags outside the head, even in a correctly signed page", async () => {
    const body = `<meta name="tulip-pr-url" content="${EVIL_URL}"><meta name="tulip-signature" content="${UNSIGNED}">`;
    await writeSigned(page(body));

    const run = await readSignedPage(pagePath, keyPath);

    expect(run.pr.repoPath).toBe("octo/widgets");
  });

  it("refuses a page whose only tags, though signed, are in the body", async () => {
    const unsigned = `<!doctype html><head></head><body>${pageRunMetaTags(RUN)}</body>`;
    const signature = await sign(unsigned, keyPath);
    await writeFile(pagePath, unsigned.replace(UNSIGNED, signature));

    await expect(readSignedPage(pagePath, keyPath)).rejects.toThrow("isn't a page signed by Tulip");
  });

  it("reads Tulip's tags, not ones the model wrote into the page", async () => {
    const rendered = renderFixturePage({
      markdown: `<meta name="tulip-pr-url" content="${EVIL_URL}">\n\n<meta name="tulip-signature" content="${"1".repeat(SIGNATURE_LENGTH)}">`,
    });
    await writeSigned(rendered);

    const run = await readSignedPage(pagePath, keyPath);

    expect(run.pr).toEqual({ forge: "github", host: "github.com", repoPath: "a/b", number: 1 });
  });

  it("refuses a signed page that names an invalid PR URL", async () => {
    await writeSigned(page(undefined, { ...RUN, prUrl: "https://example.com/nope" }));

    await expect(readSignedPage(pagePath, keyPath)).rejects.toThrow("doesn't name a valid PR");
  });

  it("says what's missing when the page is gone", async () => {
    await expect(readSignedPage(pagePath, keyPath)).rejects.toThrow("ENOENT");
  });
});

describe("signPage", () => {
  it("refuses a page without a placeholder", async () => {
    await expect(signPage("<!doctype html><head></head>", keyPath)).rejects.toThrow(
      "no signature placeholder",
    );
  });

  it("refuses a key of the wrong length", async () => {
    await mkdir(join(dir, "keys"));
    await writeFile(keyPath, "");

    await expect(signPage(page(), keyPath)).rejects.toThrow("isn't a valid share key");
  });

  it("fails when the key can't be created", async () => {
    await writeFile(join(dir, "keys"), "not a directory");

    await expect(signPage(page(), keyPath)).rejects.toThrow();
  });
});
