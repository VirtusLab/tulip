import { describe, expect, it } from "vitest";
import { AgentOutputError } from "../errors.js";
import type { JsonSchema } from "../schema.js";
import { cursorAnthropicBackend } from "./cursor.js";

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

describe("cursorAnthropicBackend.planSpawn", () => {
  it("runs headless, read-only (--mode ask), trusting the checkout, with the model", async () => {
    expect(
      (await cursorAnthropicBackend.planSpawn({ model: "m1", schema: SCHEMA, prompt: "" })).args,
    ).toEqual(["-p", "--output-format", "json", "--mode", "ask", "--trust", "--model", "m1"]);
  });

  it("passes --model on a resume too, alongside --resume", async () => {
    const args = (
      await cursorAnthropicBackend.planSpawn({
        model: "m1",
        resumeSessionId: "chat-1",
        schema: SCHEMA,
        prompt: "",
      })
    ).args;

    expect(args.slice(-4)).toEqual(["--model", "m1", "--resume", "chat-1"]);
  });

  it("omits --model on a resume of an unknown session", async () => {
    const { args } = await cursorAnthropicBackend.planSpawn({
      resumeSessionId: "chat-1",
      schema: SCHEMA,
      prompt: "",
    });

    expect(args).not.toContain("--model");
    expect(args.slice(-2)).toEqual(["--resume", "chat-1"]);
  });

  it("never grants write/shell or auto-approves MCP servers", async () => {
    const args = (
      await cursorAnthropicBackend.planSpawn({
        model: "m1",
        resumeSessionId: "chat-1",
        schema: SCHEMA,
        prompt: "",
      })
    ).args;

    for (const flag of ["--force", "-f", "--yolo", "--approve-mcps", "--auto-review"]) {
      expect(args).not.toContain(flag);
    }
  });

  it("appends the JSON-only instruction and the schema to the prompt", async () => {
    const { prompt } = await cursorAnthropicBackend.planSpawn({
      schema: SCHEMA,
      prompt: "do the thing",
    });

    expect(prompt.startsWith("do the thing\n\n")).toBe(true);
    expect(prompt).toMatch(/Reply with ONLY a single JSON object/);
    expect(prompt.endsWith(JSON.stringify(SCHEMA))).toBe(true);
  });
});

describe("cursorAnthropicBackend.parseReply", () => {
  it("maps the envelope: session id, text, parsed JSON, duration, camelCase usage", () => {
    const reply = cursorAnthropicBackend.parseReply(
      envelope({
        usage: { inputTokens: 4, outputTokens: 5, cacheReadTokens: 6, cacheWriteTokens: 7 },
      }),
      SCHEMA,
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
    const reply = cursorAnthropicBackend.parseReply(
      envelope({ usage: { inputTokens: "lots", outputTokens: 7 } }),
      SCHEMA,
    );
    expect(reply.usage).toEqual({ input: 0, output: 7, cacheWrite: 0, cacheRead: 0 });
  });

  it("leaves usage absent when the envelope has none", () => {
    expect(cursorAnthropicBackend.parseReply(envelope(), SCHEMA).usage).toBeUndefined();
  });

  it("leaves structured undefined when the reply text has no JSON", () => {
    expect(
      cursorAnthropicBackend.parseReply(envelope({ result: "just prose" }), SCHEMA).structured,
    ).toBeUndefined();
  });

  it("throws AgentOutputError on unparseable stdout", () => {
    expect(() => cursorAnthropicBackend.parseReply("not json", SCHEMA)).toThrow(AgentOutputError);
  });

  it("throws AgentOutputError when result/session_id are missing", () => {
    expect(() =>
      cursorAnthropicBackend.parseReply(JSON.stringify({ type: "result" }), SCHEMA),
    ).toThrow(/missing string "result"\/"session_id"/);
  });

  it("throws AgentOutputError, not a TypeError, when result isn't a string", () => {
    expect(() => cursorAnthropicBackend.parseReply(envelope({ result: 42 }), SCHEMA)).toThrow(
      AgentOutputError,
    );
  });

  it("throws AgentOutputError when the envelope reports an error", () => {
    expect(() =>
      cursorAnthropicBackend.parseReply(envelope({ is_error: true, result: "boom" }), SCHEMA),
    ).toThrow(/cursor-anthropic reported an error: boom/);
  });
});
