import { config } from "../config.js";
import type { PrCheckout } from "../github/checkout.js";
import { type AlignedRow, buildAlignedDiff } from "./line-diff.js";

/** Files whose base or head content exceeds this size (per side) aren't embedded for
 * client-side context expansion — ruling: prevents multi-MB pages. The `{{snippet}}` marker's
 * own range still renders (see ./snippets.ts); only "expand more context" is disabled. */
const EMBED_SIZE_CAP_BYTES = config.limits.embedSizeCapBytes;

/** One referenced file's side-by-side diff, ready to render. */
export interface FileDiffData {
  rows: AlignedRow[];
  /** False when either side's content exceeds {@link EMBED_SIZE_CAP_BYTES}. */
  embeddable: boolean;
}

/**
 * Loads base/head content for each of `paths` (deduplicated) from `checkout` and builds each
 * file's side-by-side diff alignment (see ./line-diff.ts). Meant to be called once per render
 * with every path referenced by a `{{snippet}}` marker across all categories, so a file
 * touched by several markers is only fetched and diffed once. A path present in neither
 * revision is simply omitted from the result.
 *
 * `renamedFrom` maps a referenced (head-side) path to the base-side path it was renamed from
 * (see `FileDiff.previousPath` in src/diff/parse-diff.ts) — without it, a renamed-with-changes
 * file's base content would be looked up under its *new* path, which doesn't exist at the base
 * revision.
 */
export async function loadFileDiffs(
  paths: Iterable<string>,
  checkout: Pick<PrCheckout, "getFileAtBase" | "getFileAtHead">,
  renamedFrom: Map<string, string> = new Map(),
): Promise<Map<string, FileDiffData>> {
  const result = new Map<string, FileDiffData>();
  const uniquePaths = [...new Set(paths)];

  await Promise.all(
    uniquePaths.map(async (path) => {
      const basePath = renamedFrom.get(path) ?? path;
      const [base, head] = await Promise.all([
        checkout.getFileAtBase(basePath),
        checkout.getFileAtHead(path),
      ]);
      if (base === undefined && head === undefined) {
        return;
      }
      const baseContent = base ?? "";
      const headContent = head ?? "";
      const embeddable =
        byteLength(baseContent) <= EMBED_SIZE_CAP_BYTES &&
        byteLength(headContent) <= EMBED_SIZE_CAP_BYTES;
      result.set(path, { rows: buildAlignedDiff(baseContent, headContent), embeddable });
    }),
  );

  return result;
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}
