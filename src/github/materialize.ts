import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import type { FileDiff, ParsedDiff } from "../diff/change.js";
import type { PrCheckout } from "./checkout.js";

/** Subdirectory (inside the checkout dir) holding deterministic exploration aids for a claude
 * session: the full diff and each changed file's pre-change (base) content. Lives under the
 * checkout dir so `PrCheckout.cleanup()` removes it along with everything else. */
const TULIP_DIR = ".tulip";
const DIFF_FILENAME = "pr.diff";
const BASE_SUBDIR = "base";

/**
 * Writes deterministic exploration aids into the checkout, alongside the already-checked-out
 * head working tree (see src/github/checkout.ts): the complete unified diff at
 * `.tulip/pr.diff`, and the pre-change (base) content of every changed file under
 * `.tulip/base/<path>` (the base-side path, for a rename). A claude session can then Read/Grep
 * both freely, with no git access of its own — see docs/adr/0002.
 *
 * Head (after) content isn't duplicated here — it's already the checkout's working tree at
 * `checkout.dir`. Skips binary files (no meaningful base text) and added files (nothing existed
 * at base to write).
 */
export async function materializeChangeArtifacts(
  checkout: Pick<PrCheckout, "dir" | "getFileAtBase">,
  diff: ParsedDiff,
  rawDiff: string,
): Promise<void> {
  const tulipDir = join(checkout.dir, TULIP_DIR);
  await mkdir(tulipDir, { recursive: true });
  await writeFile(join(tulipDir, DIFF_FILENAME), rawDiff, "utf8");

  const baseDir = join(tulipDir, BASE_SUBDIR);
  await Promise.all(diff.files.map((file) => materializeBaseFile(checkout, baseDir, file)));
}

async function materializeBaseFile(
  checkout: Pick<PrCheckout, "getFileAtBase">,
  baseDir: string,
  file: FileDiff,
): Promise<void> {
  if (file.binary || file.status === "added") {
    return;
  }
  // Renamed files' base content lives under their pre-rename path; every other status's `path`
  // already is the base-side path (removed) or unchanged across the rename (modified).
  const basePath = file.previousPath ?? file.path;
  const destination = resolveWithinBaseDir(baseDir, basePath);
  if (!destination) {
    return;
  }
  const content = await checkout.getFileAtBase(basePath);
  if (content === undefined) {
    return;
  }
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content, "utf8");
}

/** Resolves `basePath` under `baseDir`, refusing to write outside it. Defense in depth against
 * a `../`-containing path in the diff — real diff paths shouldn't contain traversal segments,
 * but this is the one place a PR's own file paths drive a filesystem write (see docs/adr/0002's
 * arbitrary-file-write finding for why paths derived from PR content get this scrutiny here). */
function resolveWithinBaseDir(baseDir: string, basePath: string): string | undefined {
  const destination = join(baseDir, basePath);
  const rel = relative(baseDir, destination);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return undefined;
  }
  return destination;
}
