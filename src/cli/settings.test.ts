import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readUserSettings, saveUserSettings, userSettingsPath } from "./settings.js";

describe("userSettingsPath", () => {
  it("uses $XDG_CONFIG_HOME when set", () => {
    expect(userSettingsPath({ XDG_CONFIG_HOME: "/xdg" }, "linux", "/home/u")).toBe(
      "/xdg/tulip/config.json",
    );
  });

  it("falls back to ~/.config when $XDG_CONFIG_HOME is unset or empty", () => {
    expect(userSettingsPath({}, "darwin", "/Users/u")).toBe("/Users/u/.config/tulip/config.json");
    expect(userSettingsPath({ XDG_CONFIG_HOME: "" }, "linux", "/home/u")).toBe(
      "/home/u/.config/tulip/config.json",
    );
  });

  it("uses %APPDATA% on Windows", () => {
    expect(userSettingsPath({ APPDATA: "C:/AppData" }, "win32", "C:/Users/u")).toBe(
      join("C:/AppData", "tulip", "config.json"),
    );
  });

  it("falls back to <home>/AppData/Roaming on Windows when %APPDATA% is unset", () => {
    expect(userSettingsPath({}, "win32", "C:/Users/u")).toBe(
      join("C:/Users/u", "AppData", "Roaming", "tulip", "config.json"),
    );
  });
});

describe("readUserSettings / saveUserSettings", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tulip-settings-"));
    path = join(dir, "nested", "tulip", "config.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads nothing from a missing file", async () => {
    expect(await readUserSettings(path)).toEqual({});
  });

  it("round-trips the agent, creating missing directories", async () => {
    await saveUserSettings(path, { agent: "cursor-anthropic" });

    expect(await readUserSettings(path)).toEqual({ agent: "cursor-anthropic" });
  });

  it("keeps other keys already in the file when saving", async () => {
    await saveUserSettings(path, { agent: "claude" });
    const withExtra = { ...JSON.parse(await readFile(path, "utf8")), other: 1 };
    await writeFile(path, JSON.stringify(withExtra));

    await saveUserSettings(path, { agent: "cursor-grok" });

    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ agent: "cursor-grok", other: 1 });
  });

  it("treats malformed JSON or an unknown agent as nothing saved", async () => {
    const file = join(dir, "config.json");
    await writeFile(file, "{not json");
    expect(await readUserSettings(file)).toEqual({});

    await writeFile(file, JSON.stringify({ agent: "gemini" }));
    expect(await readUserSettings(file)).toEqual({});

    await writeFile(file, JSON.stringify({ agent: "cursor" }));
    expect(await readUserSettings(file)).toEqual({});
  });
});
