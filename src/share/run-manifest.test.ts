import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSharableRun, writeRunManifest } from "./run-manifest.js";

const RUN = {
  prUrl: "https://github.com/octo/widgets/pull/42",
  headSha: "c".repeat(40),
  generatedAt: new Date("2026-10-19T14:32:00.000Z"),
};
const PAGE = "<!doctype html><title>page</title>";

let dir: string;
let keyPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tulip-run-"));
  keyPath = join(dir, "keys", "share-key");
  await writeFile(join(dir, "index.html"), "<html></html>");
  await writeFile(join(dir, "standalone.html"), PAGE);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function manifest(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(dir, "tulip-run.json"), "utf8"));
}

describe("readSharableRun", () => {
  it.each([
    ["the directory", () => dir],
    ["a file in it", () => join(dir, "index.html")],
    ["a file:// URL to a file in it", () => pathToFileURL(join(dir, "index.html")).href],
  ])("reads back a run this user signed, from %s", async (_, location) => {
    await writeRunManifest(dir, RUN, keyPath);

    const run = await readSharableRun(location(), keyPath);

    expect(run).toEqual({
      pr: { forge: "github", host: "github.com", repoPath: "octo/widgets", number: 42 },
      preview: { page: PAGE, headSha: RUN.headSha, generatedAt: RUN.generatedAt },
    });
  });

  it("creates the signing key readable only by the user", async () => {
    await writeRunManifest(dir, RUN, keyPath);

    expect((await stat(keyPath)).mode & 0o777).toBe(0o600);
  });

  it.each([
    ["a changed page", () => writeFile(join(dir, "standalone.html"), `${PAGE}<a href=x>`)],
    [
      "a manifest pointed at another PR",
      async () =>
        writeFile(
          join(dir, "tulip-run.json"),
          JSON.stringify({ ...(await manifest()), prUrl: "https://github.com/octo/other/pull/1" }),
        ),
    ],
  ])("refuses %s", async (_, tamper) => {
    await writeRunManifest(dir, RUN, keyPath);
    await tamper();

    await expect(readSharableRun(dir, keyPath)).rejects.toThrow(
      "wasn't produced by Tulip for this user, or changed since",
    );
  });

  it("refuses a run signed with someone else's key", async () => {
    await writeRunManifest(dir, RUN, join(dir, "their-key"));

    await expect(readSharableRun(dir, keyPath)).rejects.toThrow("wasn't produced by Tulip");
  });

  it("says what's missing when the page is gone", async () => {
    await writeRunManifest(dir, RUN, keyPath);
    await rm(join(dir, "standalone.html"));

    await expect(readSharableRun(dir, keyPath)).rejects.toThrow("ENOENT");
  });

  it("explains a directory that isn't a run", async () => {
    await expect(readSharableRun(dir, keyPath)).rejects.toThrow("isn't a Tulip run directory");
  });

  it("refuses an oversized manifest", async () => {
    await writeFile(join(dir, "tulip-run.json"), " ".repeat(5000));

    await expect(readSharableRun(dir, keyPath)).rejects.toThrow("too large");
  });

  it.each([
    ["isn't JSON", () => "{"],
    ["has another version", (m: Record<string, unknown>) => ({ ...m, version: 2 })],
    ["has a malformed head sha", (m: Record<string, unknown>) => ({ ...m, headSha: "HEAD" })],
    ["has a malformed date", (m: Record<string, unknown>) => ({ ...m, generatedAt: "yesterday" })],
    ["has a malformed signature", (m: Record<string, unknown>) => ({ ...m, signature: "x" })],
  ])("refuses a manifest that %s", async (_, edit) => {
    await writeRunManifest(dir, RUN, keyPath);
    const edited = edit(await manifest());
    await writeFile(
      join(dir, "tulip-run.json"),
      typeof edited === "string" ? edited : JSON.stringify(edited),
    );

    await expect(readSharableRun(dir, keyPath)).rejects.toThrow("tulip-run.json");
  });

  it("refuses a manifest with an invalid PR URL", async () => {
    await writeRunManifest(dir, { ...RUN, prUrl: "https://example.com/nope" }, keyPath);

    await expect(readSharableRun(dir, keyPath)).rejects.toThrow("invalid PR URL");
  });
});
