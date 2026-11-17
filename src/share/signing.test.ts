import { createHmac, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sign } from "./signing.js";

let dir: string;
let keyPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tulip-signing-"));
  keyPath = join(dir, "keys", "share-key");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("sign", () => {
  it("creates one 32-byte key when runs start at the same time, leaving no temp files", async () => {
    const signatures = await Promise.all(Array.from({ length: 20 }, () => sign("data", keyPath)));

    const key = await readFile(keyPath);
    expect(key.length).toBe(32);
    const expected = createHmac("sha256", key).update("data").digest("hex");
    expect(new Set(signatures)).toEqual(new Set([expected]));
    expect(await readdir(join(dir, "keys"))).toEqual(["share-key"]);
  });

  it("uses an existing key without replacing it", async () => {
    const key = randomBytes(32);
    await mkdir(join(dir, "keys"));
    await writeFile(keyPath, key);

    const signature = await sign("data", keyPath);

    expect(signature).toBe(createHmac("sha256", key).update("data").digest("hex"));
    expect(await readFile(keyPath)).toEqual(key);
  });

  it.skipIf(process.platform === "win32")("creates the key readable only by the user", async () => {
    await sign("data", keyPath);

    expect((await stat(keyPath)).mode & 0o777).toBe(0o600);
  });
});
