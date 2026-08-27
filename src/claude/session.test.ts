import { describe, expect, it, vi } from "vitest";
import type { ClaudeProcessResult } from "./exec.js";
import { PREAMBLE } from "./preamble.js";
import type { JsonSchema } from "./schema.js";
import { resumeSession, runSession } from "./session.js";

const SCHEMA: JsonSchema = {
  type: "object",
  required: ["ok"],
  properties: { ok: { type: "boolean" } },
};

function envelope(sessionId = "session-1"): ClaudeProcessResult {
  return {
    stdout: JSON.stringify({
      result: "done",
      session_id: sessionId,
      structured_output: { ok: true },
    }),
    stderr: "",
  };
}

describe("runSession", () => {
  it("prepends the shared preamble to the prompt, sent via stdin", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) => envelope());

    await runSession({ model: "sonnet", schema: SCHEMA, prompt: "say hi" }, { runClaudeProcess });

    const input = runClaudeProcess.mock.calls[0]?.[1];
    expect(input).toBe(`${PREAMBLE}\n\nsay hi`);
  });

  it("returns the structured result and session id", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) => envelope("abc"));

    const { result, sessionId } = await runSession(
      { model: "haiku", schema: SCHEMA, prompt: "say hi" },
      { runClaudeProcess },
    );

    expect(result).toEqual({ ok: true });
    expect(sessionId).toBe("abc");
  });
});

describe("resumeSession", () => {
  it("sends the prompt as-is (no preamble) via stdin, and resumes the given session id", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) => envelope("abc"));

    await resumeSession(
      { sessionId: "abc", schema: SCHEMA, prompt: "follow up" },
      { runClaudeProcess },
    );

    const [args, input] = runClaudeProcess.mock.calls[0] ?? [];
    expect(input).toBe("follow up");
    expect(args).toContain("--resume");
    expect((args as string[])[(args as string[]).indexOf("--resume") + 1]).toBe("abc");
    expect(args).not.toContain("--model");
  });
});
