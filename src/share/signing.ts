import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Only this user's Tulip can sign a run, so `tulip share` publishes nothing it didn't render,
 * whoever put the run directory together (docs/adr/0029). The key lives next to the settings. */
export function shareKeyPath(settingsPath: string): string {
  return join(dirname(settingsPath), "share-key");
}

/** `values` are serialized as a JSON array, so no two different lists sign the same bytes. */
export async function sign(values: string[], keyPath: string): Promise<string> {
  return createHmac("sha256", await shareKey(keyPath))
    .update(JSON.stringify(values))
    .digest("hex");
}

export async function isSignedByThisUser(
  values: string[],
  signature: string,
  keyPath: string,
): Promise<boolean> {
  const expected = Buffer.from(await sign(values, keyPath), "hex");
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function shareKey(keyPath: string): Promise<Buffer> {
  try {
    return await readFile(keyPath);
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") {
      throw error;
    }
  }
  await mkdir(dirname(keyPath), { recursive: true });
  try {
    await writeFile(keyPath, randomBytes(32), { mode: 0o600, flag: "wx" });
  } catch (error) {
    // Another run created it first.
    if ((error as { code?: string }).code !== "EEXIST") {
      throw error;
    }
  }
  return readFile(keyPath);
}
