import { describe, expect, it } from "vitest";
import { config } from "../config.js";
import {
  buildPreviewComment,
  buildSupersededComment,
  isPreviewComment,
  PREVIEW_MARKER,
  type PreviewEntry,
  previewEntries,
} from "./preview-comment.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const DOWNLOAD = "gh api 'repos/o/r/contents/x.html?ref=e' > x.html";

function entry(sha: string, generatedAt = "2026-10-19T14:32:05.000Z"): PreviewEntry {
  return {
    sha,
    url: `https://github.com/o/r/blob/${"e".repeat(40)}/tulip-pr-7-${sha.slice(0, 7)}.html`,
    generatedAt,
  };
}

describe("buildPreviewComment", () => {
  it("links the preview, names its commit and time, and shows how to download it", () => {
    const body = buildPreviewComment(entry(SHA_A), DOWNLOAD, []);

    expect(body.slice(0, body.indexOf(PREVIEW_MARKER))).toBe(
      "🌷 **[Tulip](https://github.com/VirtusLab/tulip) explanation of this PR** (as of `aaaaaaa`): " +
        `[\`tulip-pr-7-aaaaaaa.html\`](${entry(SHA_A).url}) (2026-10-19 14:32 UTC)\n\n` +
        "The changes grouped by concern, most important first, with diagrams. Download the file " +
        "(from its page, or with this command) and open it in a browser:\n\n" +
        `\`\`\`sh\n${DOWNLOAD}\n\`\`\`\n\n` +
        '<sub>GitHub\'s "not on any branch" warning is expected: previews live on hidden refs.</sub>\n\n',
    );
  });

  it("lists earlier previews, without the current commit", () => {
    const body = buildPreviewComment(entry(SHA_A), DOWNLOAD, [
      entry(SHA_A, "2026-10-18T09:00:00.000Z"),
      entry(SHA_B, "2026-10-18T10:00:00.000Z"),
    ]);

    expect(body).toContain("<details><summary>Earlier previews</summary>");
    expect(body).toContain("- `bbbbbbb` on 2026-10-18 10:00 UTC:");
    expect(body).not.toContain("2026-10-18 09:00 UTC");
  });

  it("lists at most the configured number of earlier previews, newest first", () => {
    const max = config.preview.maxEarlierPreviews;
    const earlier = Array.from({ length: max + 1 }, (_, i) =>
      entry((i + 1).toString(16).padStart(40, "0")),
    );

    const body = buildPreviewComment(entry(SHA_A), DOWNLOAD, earlier);

    expect(previewEntries(body)).toEqual([entry(SHA_A), ...earlier.slice(0, max)]);
  });

  it("round-trips its previews through previewEntries", () => {
    const body = buildPreviewComment(entry(SHA_A), DOWNLOAD, [entry(SHA_B)]);

    expect(previewEntries(body)).toEqual([entry(SHA_A), entry(SHA_B)]);
  });
});

describe("isPreviewComment", () => {
  const body = buildPreviewComment(entry(SHA_A), DOWNLOAD, []);

  it("recognizes a preview comment, also with CRLF line endings and trailing whitespace", () => {
    expect(isPreviewComment(body)).toBe(true);
    expect(isPreviewComment(`${body.replace(/\n/g, "\r\n")}\r\n`)).toBe(true);
  });

  it("ignores a comment quoting the marker before its end", () => {
    expect(isPreviewComment(`${body}\n\nThanks, looks good`)).toBe(false);
  });

  it("ignores a comment ending with the marker but without the header", () => {
    expect(isPreviewComment(`Look:\n\n${body.slice(body.indexOf(PREVIEW_MARKER))}`)).toBe(false);
  });
});

describe("previewEntries", () => {
  it("is empty for a body without state", () => {
    expect(previewEntries("just a comment")).toEqual([]);
  });

  it("reads the state at the end, not one quoted earlier", () => {
    const quoted = buildPreviewComment(entry(SHA_B), DOWNLOAD, []);
    const body = buildPreviewComment(entry(SHA_A), quoted, []);

    expect(previewEntries(body)).toEqual([entry(SHA_A)]);
  });

  it("is empty for malformed state", () => {
    expect(previewEntries("<!-- tulip-preview {not json} -->")).toEqual([]);
  });

  it("drops entries that don't look like previews", () => {
    const state = {
      previews: [entry(SHA_A), { ...entry(SHA_B), sha: "not-a-sha" }],
    };

    expect(previewEntries(`<!-- tulip-preview ${JSON.stringify(state)} -->`)).toEqual([
      entry(SHA_A),
    ]);
  });

  it("re-serializes the time, so text inside it never reaches a posted comment", () => {
    const sneaky = "Jan 1 2020 (--> **[click](https://evil.example)** <!--)";
    const state = { previews: [{ ...entry(SHA_B), generatedAt: sneaky }] };

    const earlier = previewEntries(`<!-- tulip-preview ${JSON.stringify(state)} -->`);
    const body = buildPreviewComment(entry(SHA_A), DOWNLOAD, earlier);

    expect(earlier[0]?.generatedAt).toBe(new Date(Date.parse(sneaky)).toISOString());
    expect(body).not.toContain("evil.example");
    expect(body.indexOf("-->")).toBe(body.length - 3);
  });
});

describe("the hidden state", () => {
  it("can't be closed early by any value in it", () => {
    const body = buildPreviewComment(
      { ...entry(SHA_A), url: "https://github.com/o/r/blob/c/a-->b.html" },
      DOWNLOAD,
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
