import { describe, expect, it, vi } from "vitest";
import { ClaudeBinaryMissingError, ClaudeOutputError } from "./errors.js";
import type { ClaudeProcessResult } from "./exec.js";
import { type ClaudeInvocation, invokeClaude } from "./runner.js";
import type { JsonSchema } from "./schema.js";

const SCHEMA: JsonSchema = {
  type: "object",
  required: ["ok"],
  properties: { ok: { type: "boolean" } },
};

const BASE_INVOCATION: ClaudeInvocation = {
  model: "sonnet",
  schema: SCHEMA,
  prompt: "do the thing",
};

function envelope(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    result: "done",
    session_id: "session-1",
    structured_output: { ok: true },
    ...overrides,
  });
}

function processResult(stdout: string): ClaudeProcessResult {
  return { stdout, stderr: "" };
}

describe("invokeClaude", () => {
  it("returns the validated structured output and session id on success", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[]) => processResult(envelope()));

    const { result, sessionId } = await invokeClaude(BASE_INVOCATION, { runClaudeProcess });

    expect(result).toEqual({ ok: true });
    expect(sessionId).toBe("session-1");
    expect(runClaudeProcess).toHaveBeenCalledTimes(1);
  });

  it("builds the CLI args (-p, --output-format json, --json-schema, --model) and sends the prompt via stdin, not argv", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      processResult(envelope()),
    );

    await invokeClaude(BASE_INVOCATION, { runClaudeProcess });

    expect(runClaudeProcess).toHaveBeenCalledWith(
      [
        "-p",
        "--output-format",
        "json",
        "--json-schema",
        JSON.stringify(SCHEMA),
        "--model",
        "sonnet",
      ],
      "do the thing",
    );
  });

  it("passes --resume instead of --model when resuming a session, prompt still via stdin", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      processResult(envelope()),
    );

    await invokeClaude(
      { resumeSessionId: "session-1", schema: SCHEMA, prompt: "follow up" },
      { runClaudeProcess },
    );

    const [args, input] = runClaudeProcess.mock.calls[0] ?? [];
    expect(args).toContain("--resume");
    expect((args as string[])[(args as string[]).indexOf("--resume") + 1]).toBe("session-1");
    expect(args).not.toContain("--model");
    expect(input).toBe("follow up");
  });

  it("retries once, by resuming, when structured output fails schema validation", async () => {
    const runClaudeProcess = vi
      .fn()
      .mockResolvedValueOnce(
        processResult(envelope({ structured_output: { ok: "not a boolean" } })),
      )
      .mockResolvedValueOnce(processResult(envelope({ session_id: "session-2" })));

    const { result, sessionId } = await invokeClaude(BASE_INVOCATION, { runClaudeProcess });

    expect(result).toEqual({ ok: true });
    expect(sessionId).toBe("session-2");
    expect(runClaudeProcess).toHaveBeenCalledTimes(2);
    const [retryArgs, retryInput] = runClaudeProcess.mock.calls[1] ?? [];
    expect(retryArgs).toContain("--resume");
    expect((retryArgs as string[])[(retryArgs as string[]).indexOf("--resume") + 1]).toBe(
      "session-1",
    );
    expect(retryInput).toMatch(/did not parse as JSON matching the required schema/);
  });

  it("retries once when structured_output is missing entirely", async () => {
    const runClaudeProcess = vi
      .fn()
      .mockResolvedValueOnce(
        processResult(JSON.stringify({ result: "no schema here", session_id: "s1" })),
      )
      .mockResolvedValueOnce(processResult(envelope()));

    const { result } = await invokeClaude(BASE_INVOCATION, { runClaudeProcess });

    expect(result).toEqual({ ok: true });
    expect(runClaudeProcess).toHaveBeenCalledTimes(2);
  });

  it("throws ClaudeOutputError when the retry also fails validation", async () => {
    const invalid = envelope({ structured_output: { ok: "nope" } });
    const runClaudeProcess = vi.fn(async () => processResult(invalid));

    await expect(invokeClaude(BASE_INVOCATION, { runClaudeProcess })).rejects.toThrow(
      ClaudeOutputError,
    );
    expect(runClaudeProcess).toHaveBeenCalledTimes(2);
  });

  it("throws ClaudeOutputError on unparseable stdout", async () => {
    const runClaudeProcess = vi.fn(async () => processResult("not json"));

    await expect(invokeClaude(BASE_INVOCATION, { runClaudeProcess })).rejects.toThrow(
      ClaudeOutputError,
    );
  });

  it("propagates process-level errors without retrying", async () => {
    const runClaudeProcess = vi.fn(async () => {
      throw new ClaudeBinaryMissingError();
    });

    await expect(invokeClaude(BASE_INVOCATION, { runClaudeProcess })).rejects.toThrow(
      ClaudeBinaryMissingError,
    );
    expect(runClaudeProcess).toHaveBeenCalledTimes(1);
  });

  it("never runs more than 3 claude processes concurrently", async () => {
    let inFlight = 0;
    let peak = 0;
    const runClaudeProcess = vi.fn(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return processResult(envelope());
    });

    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        invokeClaude({ ...BASE_INVOCATION, prompt: `task ${i}` }, { runClaudeProcess }),
      ),
    );

    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBe(3);
  });
});
