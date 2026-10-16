import { lstat, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentOutputError } from "../errors.js";
import type { JsonSchema } from "../schema.js";
import { extractJson } from "../util.js";
import { cursorBackend } from "./cursor.js";

const SCHEMA: JsonSchema = {
  type: "object",
  required: ["ok"],
  properties: { ok: { type: "boolean" } },
};

function envelope(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 1234,
    result: '{"ok": true}',
    session_id: "chat-1",
    ...overrides,
  });
}

describe("cursorBackend.planSpawn", () => {
  it("runs headless, read-only (--mode ask), trusting the checkout, with the model", () => {
    expect(cursorBackend.planSpawn({ model: "m1", schema: SCHEMA, prompt: "" }).args).toEqual([
      "-p",
      "--output-format",
      "json",
      "--mode",
      "ask",
      "--trust",
      "--model",
      "m1",
    ]);
  });

  it("passes --model on a resume too, alongside --resume", () => {
    const args = cursorBackend.planSpawn({
      model: "m1",
      resumeSessionId: "chat-1",
      schema: SCHEMA,
      prompt: "",
    }).args;

    expect(args.slice(-4)).toEqual(["--model", "m1", "--resume", "chat-1"]);
  });

  it("never grants write/shell or auto-approves MCP servers", () => {
    const args = cursorBackend.planSpawn({
      model: "m1",
      resumeSessionId: "chat-1",
      schema: SCHEMA,
      prompt: "",
    }).args;

    for (const flag of ["--force", "-f", "--yolo", "--approve-mcps", "--auto-review"]) {
      expect(args).not.toContain(flag);
    }
  });

  it("appends the JSON-only instruction and the schema to the prompt", () => {
    const { prompt } = cursorBackend.planSpawn({ schema: SCHEMA, prompt: "do the thing" });

    expect(prompt.startsWith("do the thing\n\n")).toBe(true);
    expect(prompt).toMatch(/Reply with ONLY a single JSON object/);
    expect(prompt.endsWith(JSON.stringify(SCHEMA))).toBe(true);
  });
});

describe("cursorBackend.parseReply", () => {
  it("maps the envelope: session id, text, parsed JSON, duration, camelCase usage", () => {
    const reply = cursorBackend.parseReply(
      envelope({
        usage: { inputTokens: 4, outputTokens: 5, cacheReadTokens: 6, cacheWriteTokens: 7 },
      }),
    );

    expect(reply).toEqual({
      sessionId: "chat-1",
      text: '{"ok": true}',
      structured: { ok: true },
      durationMs: 1234,
      usage: { input: 4, output: 5, cacheRead: 6, cacheWrite: 7 },
    });
  });

  it("reads a missing or non-numeric usage count as 0, never throwing", () => {
    const reply = cursorBackend.parseReply(
      envelope({ usage: { inputTokens: "lots", outputTokens: 7 } }),
    );
    expect(reply.usage).toEqual({ input: 0, output: 7, cacheWrite: 0, cacheRead: 0 });
  });

  it("leaves usage absent when the envelope has none", () => {
    expect(cursorBackend.parseReply(envelope()).usage).toBeUndefined();
  });

  it("leaves structured undefined when the reply text has no JSON", () => {
    expect(cursorBackend.parseReply(envelope({ result: "just prose" })).structured).toBeUndefined();
  });

  it("throws AgentOutputError on unparseable stdout", () => {
    expect(() => cursorBackend.parseReply("not json")).toThrow(AgentOutputError);
  });

  it("throws AgentOutputError when result/session_id are missing", () => {
    expect(() => cursorBackend.parseReply(JSON.stringify({ type: "result" }))).toThrow(
      /missing string "result"\/"session_id"/,
    );
  });

  it("throws AgentOutputError, not a TypeError, when result isn't a string", () => {
    expect(() => cursorBackend.parseReply(envelope({ result: 42 }))).toThrow(AgentOutputError);
  });

  it("throws AgentOutputError when the envelope reports an error", () => {
    expect(() => cursorBackend.parseReply(envelope({ is_error: true, result: "boom" }))).toThrow(
      /reported an error: boom/,
    );
  });
});

describe("extractJson", () => {
  it("parses a bare JSON reply", () => {
    expect(extractJson('  {"a": [1, 2]}\n')).toEqual({ a: [1, 2] });
  });

  it("parses a fenced block, preferring the last one", () => {
    const text = 'Example:\n```json\n{"a": 1}\n```\nFinal:\n```json\n{"a": 2}\n```\n';

    expect(extractJson(text)).toEqual({ a: 2 });
  });

  it("parses an object after prose from earlier assistant messages", () => {
    expect(extractJson('I\'ll read the file.{"ok": true, "note": "a } in a string"}')).toEqual({
      ok: true,
      note: "a } in a string",
    });
  });

  it("skips an unbalanced brace in the prose before the object", () => {
    expect(extractJson('The function `f() {` changed. {"ok": false}')).toEqual({ ok: false });
  });

  it("skips a balanced non-JSON span whole, without parsing its inner braces", () => {
    expect(extractJson('Saw {a {"inner": 1} b} then {"ok": true}')).toEqual({ ok: true });
  });

  it("returns undefined when nothing parses", () => {
    expect(extractJson("no json { here")).toBeUndefined();
    expect(extractJson("")).toBeUndefined();
  });
});

describe("cursorBackend.prepareWorkspace", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("removes repo-controlled .cursor and .claude config, leaving everything else", async () => {
    dir = await mkdtemp(join(tmpdir(), "tulip-cursor-ws-"));
    await mkdir(join(dir, ".cursor"));
    await writeFile(join(dir, ".cursor", "hooks.json"), "{}");
    await mkdir(join(dir, ".claude"));
    await writeFile(join(dir, ".claude", "settings.json"), "{}");
    await writeFile(join(dir, "README.md"), "hi");

    await cursorBackend.prepareWorkspace?.(dir);

    expect(await readdir(dir)).toEqual(["README.md"]);
  });

  it("unlinks a symlinked .cursor without touching its target", async () => {
    dir = await mkdtemp(join(tmpdir(), "tulip-cursor-ws-"));
    const outside = join(dir, "outside");
    const checkout = join(dir, "checkout");
    await mkdir(outside);
    await writeFile(join(outside, "keep.txt"), "keep");
    await mkdir(checkout);
    await symlink(outside, join(checkout, ".cursor"));

    await cursorBackend.prepareWorkspace?.(checkout);

    await expect(lstat(join(checkout, ".cursor"))).rejects.toThrow();
    expect(await readdir(outside)).toEqual(["keep.txt"]);
  });

  it("is a no-op when neither dir exists", async () => {
    dir = await mkdtemp(join(tmpdir(), "tulip-cursor-ws-"));

    await expect(cursorBackend.prepareWorkspace?.(dir)).resolves.toBeUndefined();
  });
});
