import { lstat, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { codexBackend } from "./backends/codex.js";
import { cursorAnthropicBackend } from "./backends/cursor.js";
import { prepareWorkspace } from "./workspace.js";

describe("prepareWorkspace", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("removes repo-controlled .cursor and .claude config for Cursor, leaving everything else", async () => {
    dir = await mkdtemp(join(tmpdir(), "tulip-ws-"));
    await mkdir(join(dir, ".cursor"));
    await writeFile(join(dir, ".cursor", "hooks.json"), "{}");
    await mkdir(join(dir, ".claude"));
    await writeFile(join(dir, ".claude", "settings.json"), "{}");
    await writeFile(join(dir, "README.md"), "hi");

    await prepareWorkspace(dir, cursorAnthropicBackend);

    expect(await readdir(dir)).toEqual(["README.md"]);
  });

  it("removes repo-controlled .codex config for Codex, keeping AGENTS.md", async () => {
    dir = await mkdtemp(join(tmpdir(), "tulip-ws-"));
    await mkdir(join(dir, ".codex"));
    await writeFile(join(dir, ".codex", "config.toml"), "");
    await writeFile(join(dir, "AGENTS.md"), "keep");

    await prepareWorkspace(dir, codexBackend);

    expect(await readdir(dir)).toEqual(["AGENTS.md"]);
  });

  it("unlinks a symlinked config dir without touching its target", async () => {
    dir = await mkdtemp(join(tmpdir(), "tulip-ws-"));
    const outside = join(dir, "outside");
    const checkout = join(dir, "checkout");
    await mkdir(outside);
    await writeFile(join(outside, "keep.txt"), "keep");
    await mkdir(checkout);
    await symlink(outside, join(checkout, ".cursor"));

    await prepareWorkspace(checkout, cursorAnthropicBackend);

    await expect(lstat(join(checkout, ".cursor"))).rejects.toThrow();
    expect(await readdir(outside)).toEqual(["keep.txt"]);
  });

  it("is a no-op when no config dir exists", async () => {
    dir = await mkdtemp(join(tmpdir(), "tulip-ws-"));

    await expect(prepareWorkspace(dir, codexBackend)).resolves.toBeUndefined();
  });
});
