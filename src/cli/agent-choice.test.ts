import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AgentChoiceIo, resolveAgent } from "./agent-choice.js";
import { CliUsageError } from "./args.js";
import { readUserSettings, saveUserSettings } from "./settings.js";

/** An {@link AgentChoiceIo} that answers with `answers` in order, then EOF. */
function fakeIo(answers: string[] = [], interactive = true) {
  const queue = [...answers];
  const lines: string[] = [];
  const io: AgentChoiceIo = {
    interactive,
    ask: vi.fn(async () => queue.shift()),
    write: (line) => lines.push(line),
  };
  return { io, lines };
}

describe("resolveAgent", () => {
  let dir: string;
  let settingsPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tulip-agent-choice-"));
    settingsPath = join(dir, "tulip", "config.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("asks on first run when no --agent is given, and remembers the answer", async () => {
    const { io, lines } = fakeIo(["2"]);

    expect(await resolveAgent(undefined, { settingsPath, io })).toBe("cursor");

    expect(lines[0]).toBe("Which agent CLI should Tulip use to analyze PRs?");
    expect(lines.slice(1, 3)).toEqual([
      "  1) claude  Claude Code (runs `claude`)",
      "  2) cursor  Cursor CLI (runs `agent`)",
    ]);
    expect(lines.at(-1)).toContain(
      `Using cursor for this and future runs (saved in ${settingsPath})`,
    );
    expect(await readUserSettings(settingsPath)).toEqual({ agent: "cursor" });
  });

  it("accepts an agent name as the answer, and re-asks on an invalid one", async () => {
    const { io, lines } = fakeIo(["9", "codex", " Claude "]);

    expect(await resolveAgent(undefined, { settingsPath, io })).toBe("claude");

    expect(io.ask).toHaveBeenCalledTimes(3);
    expect(lines.filter((line) => line.startsWith("Please enter"))).toHaveLength(2);
  });

  it("uses the remembered agent without asking", async () => {
    await saveUserSettings(settingsPath, { agent: "cursor" });
    const { io, lines } = fakeIo();

    expect(await resolveAgent(undefined, { settingsPath, io })).toBe("cursor");

    expect(io.ask).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });

  it("lets --agent override the remembered agent, and remembers the new one", async () => {
    await saveUserSettings(settingsPath, { agent: "cursor" });
    const { io, lines } = fakeIo();

    expect(await resolveAgent("claude", { settingsPath, io })).toBe("claude");

    expect(io.ask).not.toHaveBeenCalled();
    expect(lines).toHaveLength(1);
    expect(await readUserSettings(settingsPath)).toEqual({ agent: "claude" });
  });

  it("says nothing when --agent matches the remembered agent", async () => {
    await saveUserSettings(settingsPath, { agent: "claude" });
    const { io, lines } = fakeIo();

    expect(await resolveAgent("claude", { settingsPath, io })).toBe("claude");

    expect(lines).toEqual([]);
  });

  it("refuses to guess in a non-interactive run with nothing remembered", async () => {
    const { io } = fakeIo([], false);

    await expect(resolveAgent(undefined, { settingsPath, io })).rejects.toThrow(
      /No agent chosen yet\. Run once with --agent <claude\|cursor>/,
    );
    expect(io.ask).not.toHaveBeenCalled();
  });

  it("fails cleanly when the user closes the prompt without answering", async () => {
    const { io } = fakeIo([]);

    await expect(resolveAgent(undefined, { settingsPath, io })).rejects.toThrow(CliUsageError);
    expect(await readUserSettings(settingsPath)).toEqual({});
  });

  it("still runs with the chosen agent when the choice can't be saved", async () => {
    const blocker = join(dir, "not-a-dir");
    await writeFile(blocker, "");
    const { io, lines } = fakeIo(["1"]);

    expect(await resolveAgent(undefined, { settingsPath: join(blocker, "config.json"), io })).toBe(
      "claude",
    );

    expect(lines.at(-1)).toMatch(/^Using claude; couldn't save the choice to /);
  });
});
