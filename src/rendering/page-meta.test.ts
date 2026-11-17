import { describe, expect, it } from "vitest";
import {
  headMeta,
  pageRunMetaTags,
  SIGNATURE_LENGTH,
  UNSIGNED,
  withSignature,
} from "./page-meta.js";

const RUN = {
  prUrl: "https://github.com/octo/widgets/pull/42",
  headSha: "c".repeat(40),
  generatedAt: new Date("2026-10-19T14:32:00.000Z"),
};

function page(head: string, body = ""): string {
  return `<!doctype html><head>${head}</head><body>${body}</body>`;
}

describe("headMeta", () => {
  it("reads back what pageRunMetaTags wrote, escaped values included", () => {
    const prUrl = 'x"><script>&';
    const html = page(pageRunMetaTags({ ...RUN, prUrl }));

    expect(html).toContain('content="x&quot;&gt;&lt;script&gt;&amp;"');
    expect(headMeta(html, "tulip-pr-url")?.value).toBe(prUrl);
    expect(headMeta(html, "tulip-head-sha")?.value).toBe(RUN.headSha);
    expect(headMeta(html, "tulip-generated-at")?.value).toBe("2026-10-19T14:32:00.000Z");
    expect(headMeta(html, "tulip-signature")?.value).toBe(UNSIGNED);
  });

  it("takes the first tag in the head", () => {
    const html = page(
      `${pageRunMetaTags(RUN)}<meta name="tulip-pr-url" content="second">`,
      '<meta name="tulip-pr-url" content="body">',
    );

    expect(headMeta(html, "tulip-pr-url")?.value).toBe(RUN.prUrl);
  });

  it("ignores tags outside the head", () => {
    expect(headMeta(page("", pageRunMetaTags(RUN)), "tulip-pr-url")).toBeUndefined();
    expect(headMeta(`<body>${pageRunMetaTags(RUN)}</body>`, "tulip-pr-url")).toBeUndefined();
  });
});

describe("withSignature", () => {
  it("replaces only the signature", () => {
    const html = page(pageRunMetaTags(RUN));
    const { offset } = headMeta(html, "tulip-signature") as { offset: number };

    const signed = withSignature(html, offset, "a".repeat(SIGNATURE_LENGTH));

    expect(signed).toBe(html.replace(UNSIGNED, "a".repeat(SIGNATURE_LENGTH)));
  });
});
