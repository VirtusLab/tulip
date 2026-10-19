import { config } from "../config.js";
import { COMMIT_SHA_PATTERN, shortSha } from "../forge/sha.js";

export interface PreviewEntry {
  sha: string;
  url: string;
  /** ISO 8601. */
  generatedAt: string;
}

/** Marks Tulip's own comment, and carries the earlier previews it lists, so a re-run can find
 * the comment and update it. */
export const PREVIEW_MARKER = "<!-- tulip-preview";
const STATE = new RegExp(`${PREVIEW_MARKER} (\\{.*\\}) -->`);

export function buildPreviewComment(current: PreviewEntry, earlier: PreviewEntry[]): string {
  const listed = earlier
    .filter((entry) => entry.sha !== current.sha)
    .slice(0, config.preview.maxEarlierPreviews);
  // Escaped so no value can end the HTML comment that hides the state.
  const state = JSON.stringify({ previews: [current, ...listed] })
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
  return [
    `🌷 **[Tulip](https://github.com/VirtusLab/tulip) explanation of this PR** (as of ` +
      `\`${shortSha(current.sha)}\`): ${link(current)} (${formatTime(current.generatedAt)})`,
    "Download the raw file and open it in a browser: the changes grouped by concern, most " +
      "important first, with diagrams.",
    // Without this, GitHub's warning on the file page reads like a spoofed commit.
    '<sub>GitHub\'s "not on any branch" warning is expected: previews live on hidden refs.</sub>',
    ...(listed.length > 0
      ? [
          "<details><summary>Earlier previews</summary>",
          listed
            .map(
              (entry) =>
                `- \`${shortSha(entry.sha)}\` on ${formatTime(entry.generatedAt)}: ${link(entry)}`,
            )
            .join("\n"),
          "</details>",
        ]
      : []),
    `${PREVIEW_MARKER} ${state} -->`,
  ].join("\n\n");
}

export function buildSupersededComment(replacementUrl: string): string {
  return `🌷 Superseded by a [newer Tulip explanation](${replacementUrl}).`;
}

export function previewEntries(body: string): PreviewEntry[] {
  const json = STATE.exec(body)?.[1];
  if (json === undefined) {
    return [];
  }
  try {
    const state: unknown = JSON.parse(json);
    const previews = (state as { previews?: unknown }).previews;
    return Array.isArray(previews) ? previews.flatMap(toPreviewEntry) : [];
  } catch {
    return [];
  }
}

/** The state can be edited by anyone with write access, and is posted again under the user's
 * name: so URLs must be ones a browser won't rewrite (no `..` or encoded-dot segments), and the
 * time is re-serialized rather than kept as written. */
function toPreviewEntry(value: unknown): PreviewEntry[] {
  const entry = value as Partial<Record<keyof PreviewEntry, unknown>>;
  if (
    typeof entry?.sha !== "string" ||
    !COMMIT_SHA_PATTERN.test(entry.sha) ||
    typeof entry.url !== "string" ||
    !/^https:\/\/[^\s()<>]+$/.test(entry.url) ||
    !URL.canParse(entry.url) ||
    new URL(entry.url).href !== entry.url ||
    typeof entry.generatedAt !== "string"
  ) {
    return [];
  }
  const time = Date.parse(entry.generatedAt);
  return Number.isNaN(time)
    ? []
    : [{ sha: entry.sha, url: entry.url, generatedAt: new Date(time).toISOString() }];
}

function link(entry: PreviewEntry): string {
  return `[\`${entry.url.slice(entry.url.lastIndexOf("/") + 1)}\`](${entry.url})`;
}

function formatTime(iso: string): string {
  return `${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
