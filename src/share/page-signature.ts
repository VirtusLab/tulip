import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { COMMIT_SHA_PATTERN } from "../forge/sha.js";
import type { Preview, PrRef } from "../forge/types.js";
import { parsePrUrl } from "../forge-registry/pr-url.js";
import { headMeta, SIGNATURE_LENGTH, UNSIGNED, withSignature } from "../rendering/page-meta.js";
import { isSignedByThisUser, sign } from "./signing.js";

export interface SharableRun {
  pr: PrRef;
  preview: Preview;
}

/** Replaces the placeholder signature of a page rendered with `pageRunMetaTags`. Fails if
 * the signing key can't be read or created. */
export async function signPage(page: string, keyPath: string): Promise<string> {
  const signature = headMeta(page, "tulip-signature");
  if (signature?.value !== UNSIGNED) {
    throw new Error("the page has no signature placeholder");
  }
  return withSignature(page, signature.offset, await sign(page, keyPath));
}

const SIGNATURE = new RegExp(`^[0-9a-f]{${SIGNATURE_LENGTH}}$`);

/** Reads a page from a path or `file://` URL. Refuses a page this user's Tulip didn't sign, or
 * that changed since. */
export async function readSignedPage(location: string, keyPath: string): Promise<SharableRun> {
  const path = location.startsWith("file://") ? fileURLToPath(location) : location;
  const page = await readFile(path, "utf8");

  const signature = headMeta(page, "tulip-signature");
  if (
    signature === undefined ||
    !SIGNATURE.test(signature.value) ||
    signature.value === UNSIGNED ||
    !(await isSignedByThisUser(
      withSignature(page, signature.offset, UNSIGNED),
      signature.value,
      keyPath,
    ))
  ) {
    throw new Error(
      `${path} isn't a page signed by Tulip for this user, or changed since; run tulip again to share it`,
    );
  }

  // Signed, so every value below was written by Tulip; checked anyway against a bug or old format.
  const prUrl = headMeta(page, "tulip-pr-url")?.value;
  const pr = prUrl === undefined ? undefined : parsePrUrl(prUrl);
  const headSha = headMeta(page, "tulip-head-sha")?.value;
  const generatedAt = headMeta(page, "tulip-generated-at")?.value;
  if (
    pr === undefined ||
    headSha === undefined ||
    !COMMIT_SHA_PATTERN.test(headSha) ||
    generatedAt === undefined ||
    Number.isNaN(Date.parse(generatedAt))
  ) {
    throw new Error(`${path} doesn't name a valid PR, commit and date`);
  }
  return { pr, preview: { page, headSha, generatedAt: new Date(generatedAt) } };
}
