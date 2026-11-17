import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Only this user's Tulip can sign a page, so `tulip share` publishes nothing it didn't render,
 * wherever the file came from (docs/adr/0029). The key lives next to the settings. */
export function shareKeyPath(settingsPath: string): string {
  return join(dirname(settingsPath), "share-key");
}

export async function sign(data: string, keyPath: string): Promise<string> {
  return createHmac("sha256", await shareKey(keyPath))
    .update(data)
    .digest("hex");
}

export async function isSignedByThisUser(
  data: string,
  signature: string,
  keyPath: string,
): Promise<boolean> {
  const expected = Buffer.from(await sign(data, keyPath), "hex");
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const KEY_BYTES = 32;

async function shareKey(keyPath: string): Promise<Buffer> {
  try {
    return await readKey(keyPath);
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") {
      throw error;
    }
  }
  await mkdir(dirname(keyPath), { recursive: true });
  // The key appears complete or not at all, and `link` never replaces a key another run created.
  const tmpPath = `${keyPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmpPath, randomBytes(KEY_BYTES), { mode: 0o600, flag: "wx" });
    await link(tmpPath, keyPath);
  } catch (error) {
    if ((error as { code?: string }).code !== "EEXIST") {
      throw error;
    }
  } finally {
    await rm(tmpPath, { force: true });
  }
  return readKey(keyPath);
}

/** A short key, e.g. left empty by a crash mid-write, would make signatures forgeable. */
async function readKey(keyPath: string): Promise<Buffer> {
  const key = await readFile(keyPath);
  if (key.length !== KEY_BYTES) {
    throw new Error(`${keyPath} isn't a valid share key; delete it to create a new one`);
  }
  return key;
}
