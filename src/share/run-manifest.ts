import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COMMIT_SHA_PATTERN } from "../forge/sha.js";
import type { Preview, PrRef } from "../forge/types.js";
import { parsePrUrl } from "../forge-registry/pr-url.js";
import { STANDALONE_FILENAME } from "../rendering/assemble.js";
import { isSignedByThisUser, sign } from "./signing.js";

const MANIFEST_FILENAME = "tulip-run.json";

const MAX_MANIFEST_BYTES = 4096;

/** What `tulip share` needs to know about a finished run (docs/adr/0029). */
export interface RunManifest {
  version: 1;
  prUrl: string;
  headSha: string;
  /** ISO 8601. */
  generatedAt: string;
  /** Over the fields above and the single-file page; see ./signing.ts. */
  signature: string;
}

export interface SharableRun {
  pr: PrRef;
  preview: Preview;
}

export async function writeRunManifest(
  dir: string,
  run: { prUrl: string; headSha: string; generatedAt: Date },
  keyPath: string,
): Promise<void> {
  const fields = {
    prUrl: run.prUrl,
    headSha: run.headSha,
    generatedAt: run.generatedAt.toISOString(),
  };
  const page = await readFile(join(dir, STANDALONE_FILENAME), "utf8");
  const manifest: RunManifest = {
    version: 1,
    ...fields,
    signature: await sign(signed(fields, page), keyPath),
  };
  await writeFile(join(dir, MANIFEST_FILENAME), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

/** Accepts the run dir, a file in it, or a `file://` URL to one: users paste what the run logged.
 * Refuses a run this user's Tulip didn't produce, or whose page or manifest changed since. */
export async function readSharableRun(location: string, keyPath: string): Promise<SharableRun> {
  const path = location.startsWith("file://") ? fileURLToPath(location) : location;
  const dir = (await stat(path).catch(() => undefined))?.isFile() ? dirname(path) : path;
  const manifestPath = join(dir, MANIFEST_FILENAME);

  const size = (await stat(manifestPath).catch(() => undefined))?.size;
  if (size === undefined) {
    throw new Error(`${dir} isn't a Tulip run directory (no ${MANIFEST_FILENAME})`);
  }
  if (size > MAX_MANIFEST_BYTES) {
    throw new Error(`${manifestPath} is too large to be a Tulip run manifest`);
  }

  const manifest = parseManifest(await readFile(manifestPath, "utf8"));
  const pr = parsePrUrl(manifest.prUrl);
  if (pr === undefined) {
    throw new Error(`${manifestPath} names an invalid PR URL`);
  }
  const page = await readFile(join(dir, STANDALONE_FILENAME), "utf8");
  if (!(await isSignedByThisUser(signed(manifest, page), manifest.signature, keyPath))) {
    throw new Error(
      `${dir} wasn't produced by Tulip for this user, or changed since; run tulip again to share it`,
    );
  }
  return {
    pr,
    preview: { page, headSha: manifest.headSha, generatedAt: new Date(manifest.generatedAt) },
  };
}

function signed(fields: Omit<RunManifest, "version" | "signature">, page: string): string[] {
  return [fields.prUrl, fields.headSha, fields.generatedAt, page];
}

function parseManifest(text: string): RunManifest {
  let value: Partial<Record<keyof RunManifest, unknown>>;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${MANIFEST_FILENAME} isn't valid JSON`);
  }
  if (
    value?.version !== 1 ||
    typeof value.signature !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.signature) ||
    typeof value.prUrl !== "string" ||
    typeof value.headSha !== "string" ||
    !COMMIT_SHA_PATTERN.test(value.headSha) ||
    typeof value.generatedAt !== "string" ||
    Number.isNaN(Date.parse(value.generatedAt))
  ) {
    throw new Error(`${MANIFEST_FILENAME} isn't a manifest this version of Tulip understands`);
  }
  return value as RunManifest;
}
