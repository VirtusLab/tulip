import { describe, expect, it } from "vitest";
import {
  buildPreviewComment,
  buildSupersededComment,
  PREVIEW_MARKER,
  type PreviewEntry,
  previewEntries,
} from "./preview-comment.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function entry(sha: string, generatedAt = "2026-10-19T14:32:05.000Z"): PreviewEntry {
  return {
    sha,
    url: `https://github.com/o/r/blob/${"e".repeat(40)}/tulip-pr-7-${sha.slice(0, 7)}.html`,
    generatedAt,
  };
}

describe("buildPreviewComment", () => {
  it("links the preview and names its commit and time", () => {
    const body = buildPreviewComment(entry(SHA_A), []);

    expect(body.split("\n")[0]).toBe(
      "🌷 **[Tulip](https://github.com/VirtusLab/tulip) explanation of this PR** (as of `aaaaaaa`): " +
        `[\`tulip-pr-7-aaaaaaa.html\`](${entry(SHA_A).url}) (2026-10-19 14:32 UTC)`,
    );
    expect(body).not.toContain("<details>");
  });

  it("lists earlier previews, without the current commit", () => {
    const body = buildPreviewComment(entry(SHA_A), [
      entry(SHA_A, "2026-10-18T09:00:00.000Z"),
      entry(SHA_B, "2026-10-18T10:00:00.000Z"),
    ]);

    expect(body).toContain("<details><summary>Earlier previews</summary>");
    expect(body).toContain("- `bbbbbbb` on 2026-10-18 10:00 UTC:");
    expect(body).not.toContain("2026-10-18 09:00 UTC");
  });

  it("round-trips its previews through previewEntries", () => {
    const body = buildPreviewComment(entry(SHA_A), [entry(SHA_B)]);

    expect(previewEntries(body)).toEqual([entry(SHA_A), entry(SHA_B)]);
  });
});

describe("previewEntries", () => {
  it("is empty for a body without state", () => {
    expect(previewEntries("just a comment")).toEqual([]);
  });

  it("is empty for malformed state", () => {
    expect(previewEntries("<!-- tulip-preview {not json} -->")).toEqual([]);
  });

  it("drops entries that don't look like previews", () => {
    const state = {
      previews: [
        entry(SHA_A),
        { ...entry(SHA_B), url: "javascript:alert(1)" },
        { ...entry(SHA_B), sha: "not-a-sha" },
      ],
    };

    expect(previewEntries(`<!-- tulip-preview ${JSON.stringify(state)} -->`)).toEqual([
      entry(SHA_A),
    ]);
  });

  it("drops URLs a browser would resolve elsewhere", () => {
    const state = {
      previews: [
        { ...entry(SHA_A), url: "https://github.com/o/r/blob/../../../evil/x/blob/c/p.html" },
        { ...entry(SHA_A), url: "https://github.com/o/r/blob/%2e%2e/%2e%2e/evil/x/p.html" },
        { ...entry(SHA_A), url: "https://github.com/o/r/blob\\..\\evil/p.html" },
      ],
    };

    expect(previewEntries(`<!-- tulip-preview ${JSON.stringify(state)} -->`)).toEqual([]);
  });

  it("re-serializes the time, so text inside it never reaches a posted comment", () => {
    const sneaky = "Jan 1 2020 (--> **[click](https://evil.example)** <!--)";
    const state = { previews: [{ ...entry(SHA_B), generatedAt: sneaky }] };

    const earlier = previewEntries(`<!-- tulip-preview ${JSON.stringify(state)} -->`);
    const body = buildPreviewComment(entry(SHA_A), earlier);

    expect(earlier[0]?.generatedAt).toBe(new Date(Date.parse(sneaky)).toISOString());
    expect(body).not.toContain("evil.example");
    expect(body.indexOf("-->")).toBe(body.length - 3);
  });
});

describe("the hidden state", () => {
  it("can't be closed early by any value in it", () => {
    const body = buildPreviewComment(
      { ...entry(SHA_A), url: "https://github.com/o/r/blob/c/a-->b.html" },
      [],
    );
    const marker = body.slice(body.indexOf(PREVIEW_MARKER));

    expect(marker.indexOf("-->")).toBe(marker.length - 3);
  });
});

describe("buildSupersededComment", () => {
  it("points at the newer comment and drops the marker, so re-runs no longer find it", () => {
    const body = buildSupersededComment("https://github.com/o/r/pull/7#issuecomment-2");

    expect(body).toContain("(https://github.com/o/r/pull/7#issuecomment-2)");
    expect(body).not.toContain("tulip-preview");
  });
});
