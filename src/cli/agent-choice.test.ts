import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveAgent } from "./agent-choice.js";
import { readUserSettings, saveUserSettings } from "./settings.js";

describe("resolveAgent", () => {
  let dir: string;
  let settingsPath: string;
  let lines: string[];
  const log = (line: string) => lines.push(line);

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tulip-agent-choice-"));
    settingsPath = join(dir, "tulip", "config.json");
    lines = [];
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("defaults to claude when nothing is given or saved, without saving it", async () => {
    expect(await resolveAgent(undefined, { settingsPath, log })).toBe("claude");

    expect(lines).toEqual([]);
    expect(await readUserSettings(settingsPath)).toEqual({});
  });

  it("uses the saved agent", async () => {
    await saveUserSettings(settingsPath, { agent: "cursor-grok" });

    expect(await resolveAgent(undefined, { settingsPath, log })).toBe("cursor-grok");

    expect(lines).toEqual([]);
  });

  it("lets --agent override the saved agent, and saves the new one", async () => {
    await saveUserSettings(settingsPath, { agent: "cursor-anthropic" });

    expect(await resolveAgent("codex", { settingsPath, log })).toBe("codex");

    expect(lines).toEqual([`Saved codex as the agent for future runs (in ${settingsPath}).`]);
    expect(await readUserSettings(settingsPath)).toEqual({ agent: "codex" });
  });

  it("says nothing when --agent matches the saved agent", async () => {
    await saveUserSettings(settingsPath, { agent: "claude" });

    expect(await resolveAgent("claude", { settingsPath, log })).toBe("claude");

    expect(lines).toEqual([]);
  });

  it("still runs with --agent when the choice can't be saved", async () => {
    const blocker = join(dir, "not-a-dir");
    await writeFile(blocker, "");

    expect(await resolveAgent("codex", { settingsPath: join(blocker, "config.json"), log })).toBe(
      "codex",
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Couldn't save codex as the agent for future runs to /);
  });
});
