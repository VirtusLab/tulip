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
  it("prepends the shared preamble to the prompt", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[]) => envelope());

    await runSession({ model: "sonnet", schema: SCHEMA, prompt: "say hi" }, { runClaudeProcess });

    const args = runClaudeProcess.mock.calls[0]?.[0] as string[];
    const prompt = args[args.indexOf("-p") + 1];
    expect(prompt).toBe(`${PREAMBLE}\n\nsay hi`);
  });

  it("returns the structured result and session id", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[]) => envelope("abc"));

    const { result, sessionId } = await runSession(
      { model: "haiku", schema: SCHEMA, prompt: "say hi" },
      { runClaudeProcess },
    );

    expect(result).toEqual({ ok: true });
    expect(sessionId).toBe("abc");
  });
});

describe("resumeSession", () => {
  it("sends the prompt as-is (no preamble) and resumes the given session id", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[]) => envelope("abc"));

    await resumeSession(
      { sessionId: "abc", schema: SCHEMA, prompt: "follow up" },
      { runClaudeProcess },
    );

    const args = runClaudeProcess.mock.calls[0]?.[0] as string[];
    expect(args[args.indexOf("-p") + 1]).toBe("follow up");
    expect(args[args.indexOf("--resume") + 1]).toBe("abc");
    expect(args).not.toContain("--model");
  });
});
