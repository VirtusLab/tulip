import { describe, expect, it, vi } from "vitest";
import { config } from "../config.js";
import { ClaudeBinaryMissingError, ClaudeOutputError } from "./errors.js";
import type { ClaudeProcessResult } from "./exec.js";
import { type ClaudeInvocation, invokeClaude } from "./runner.js";
import type { JsonSchema } from "./schema.js";
import { createUsageLedger } from "./usage.js";

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

  it("records token usage into a provided ledger, under the invocation's model", async () => {
    const runClaudeProcess = vi.fn(async () =>
      processResult(
        envelope({
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            cache_read_input_tokens: 5,
            cache_creation_input_tokens: 3,
          },
        }),
      ),
    );
    const usage = createUsageLedger();

    await invokeClaude(BASE_INVOCATION, { runClaudeProcess, usage });

    expect(usage.rows()).toEqual([
      { model: "sonnet", tokens: { input: 100, output: 20, cacheWrite: 3, cacheRead: 5 } },
    ]);
  });

  it("records usage for both the initial call and the retry, under the same model", async () => {
    let call = 0;
    const runClaudeProcess = vi.fn(async () => {
      call++;
      if (call === 1) {
        // No structured_output → invalid → one retry (a resume of this session).
        return processResult(
          JSON.stringify({
            result: "oops",
            session_id: "session-1",
            usage: { input_tokens: 100, output_tokens: 10 },
          }),
        );
      }
      return processResult(envelope({ usage: { input_tokens: 40, output_tokens: 5 } }));
    });
    const usage = createUsageLedger();

    await invokeClaude(BASE_INVOCATION, { runClaudeProcess, usage });

    expect(runClaudeProcess).toHaveBeenCalledTimes(2);
    expect(usage.rows()).toEqual([
      { model: "sonnet", tokens: { input: 140, output: 15, cacheWrite: 0, cacheRead: 0 } },
    ]);
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
      {},
    );
  });

  it("never passes --allowedTools by default — no Bash grant of any kind (see src/config.ts's claude.allowedTools doc comment: a Bash(git ...) grant was found to let the model write arbitrary files via e.g. `git log --output=<path>`); sessions rely on their default Read/Grep/Glob access instead", async () => {
    expect(config.claude.allowedTools).toEqual([]);
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      processResult(envelope()),
    );

    await invokeClaude(BASE_INVOCATION, { runClaudeProcess });

    const [args] = runClaudeProcess.mock.calls[0] ?? [];
    expect(args as string[]).not.toContain("--allowedTools");
    expect((args as string[]).some((arg) => arg.startsWith("Bash"))).toBe(false);
  });

  it("passes cwd through to the process runner when given", async () => {
    const runClaudeProcess = vi.fn(
      async (_args: string[], _input: string, _options?: { cwd?: string }) =>
        processResult(envelope()),
    );

    await invokeClaude(BASE_INVOCATION, { runClaudeProcess, cwd: "/repo/checkout" });

    expect(runClaudeProcess).toHaveBeenCalledWith(expect.any(Array), "do the thing", {
      cwd: "/repo/checkout",
    });
  });

  it("omits cwd from the options passed to the process runner when not given", async () => {
    const runClaudeProcess = vi.fn(
      async (_args: string[], _input: string, _options?: { cwd?: string }) =>
        processResult(envelope()),
    );

    await invokeClaude(BASE_INVOCATION, { runClaudeProcess });

    expect(runClaudeProcess).toHaveBeenCalledWith(expect.any(Array), "do the thing", {});
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
