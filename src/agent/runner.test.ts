import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { config } from "../config.js";
import { createLogger } from "../logging/logger.js";
import { createAgent } from "./backend.js";
import { AgentBinaryMissingError, AgentOutputError } from "./errors.js";
import type { AgentProcessResult } from "./exec.js";
import { type AgentInvocation, invokeAgent } from "./runner.js";
import type { JsonSchema } from "./schema.js";
import { createUsageLedger } from "./usage.js";

const SCHEMA: JsonSchema = {
  type: "object",
  required: ["ok"],
  properties: { ok: { type: "boolean" } },
};

const BASE_INVOCATION: AgentInvocation = {
  model: "balanced",
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

function processResult(stdout: string): AgentProcessResult {
  return { stdout, stderr: "" };
}

describe("invokeAgent", () => {
  it("returns the validated structured output and session id on success", async () => {
    const runAgentProcess = vi.fn(async (_args: string[]) => processResult(envelope()));

    const { result, sessionId } = await invokeAgent(BASE_INVOCATION, { runAgentProcess });

    expect(result).toEqual({ ok: true });
    expect(sessionId).toBe("session-1");
    expect(runAgentProcess).toHaveBeenCalledTimes(1);
  });

  it("records token usage into a provided ledger, under the invocation's model", async () => {
    const runAgentProcess = vi.fn(async () =>
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

    await invokeAgent(BASE_INVOCATION, { runAgentProcess, usage });

    expect(usage.rows()).toEqual([
      { model: "sonnet", tokens: { input: 100, output: 20, cacheWrite: 3, cacheRead: 5 } },
    ]);
  });

  it("records usage for both the initial call and the retry, under the same model", async () => {
    let call = 0;
    const runAgentProcess = vi.fn(async () => {
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

    await invokeAgent(BASE_INVOCATION, { runAgentProcess, usage });

    expect(runAgentProcess).toHaveBeenCalledTimes(2);
    expect(usage.rows()).toEqual([
      { model: "sonnet", tokens: { input: 140, output: 15, cacheWrite: 0, cacheRead: 0 } },
    ]);
  });

  it("builds the CLI args (-p, --output-format json, --json-schema, --model) and sends the prompt via stdin, not argv", async () => {
    const runAgentProcess = vi.fn(async (_args: string[], _input: string) =>
      processResult(envelope()),
    );

    await invokeAgent(BASE_INVOCATION, { runAgentProcess });

    expect(runAgentProcess).toHaveBeenCalledWith(
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

  it("never passes --allowedTools by default — no Bash grant of any kind (see src/config.ts's agents.claude.allowedTools doc comment: a Bash(git ...) grant was found to let the model write arbitrary files via e.g. `git log --output=<path>`); sessions rely on their default Read/Grep/Glob access instead", async () => {
    expect(config.agents.claude.allowedTools).toEqual([]);
    const runAgentProcess = vi.fn(async (_args: string[], _input: string) =>
      processResult(envelope()),
    );

    await invokeAgent(BASE_INVOCATION, { runAgentProcess });

    const [args] = runAgentProcess.mock.calls[0] ?? [];
    expect(args as string[]).not.toContain("--allowedTools");
    expect((args as string[]).some((arg) => arg.startsWith("Bash"))).toBe(false);
  });

  it("passes cwd through to the process runner when given", async () => {
    const runAgentProcess = vi.fn(
      async (_args: string[], _input: string, _options?: { cwd?: string }) =>
        processResult(envelope()),
    );

    await invokeAgent(BASE_INVOCATION, { runAgentProcess, cwd: "/repo/checkout" });

    expect(runAgentProcess).toHaveBeenCalledWith(expect.any(Array), "do the thing", {
      cwd: "/repo/checkout",
    });
  });

  it("omits cwd from the options passed to the process runner when not given", async () => {
    const runAgentProcess = vi.fn(
      async (_args: string[], _input: string, _options?: { cwd?: string }) =>
        processResult(envelope()),
    );

    await invokeAgent(BASE_INVOCATION, { runAgentProcess });

    expect(runAgentProcess).toHaveBeenCalledWith(expect.any(Array), "do the thing", {});
  });

  it("passes --resume instead of --model when resuming a session, prompt still via stdin", async () => {
    const runAgentProcess = vi.fn(async (_args: string[], _input: string) =>
      processResult(envelope()),
    );

    await invokeAgent(
      { resumeSessionId: "session-1", schema: SCHEMA, prompt: "follow up" },
      { runAgentProcess },
    );

    const [args, input] = runAgentProcess.mock.calls[0] ?? [];
    expect(args).toContain("--resume");
    expect((args as string[])[(args as string[]).indexOf("--resume") + 1]).toBe("session-1");
    expect(args).not.toContain("--model");
    expect(input).toBe("follow up");
  });

  it("retries once, by resuming, when structured output fails schema validation", async () => {
    const runAgentProcess = vi
      .fn()
      .mockResolvedValueOnce(
        processResult(envelope({ structured_output: { ok: "not a boolean" } })),
      )
      .mockResolvedValueOnce(processResult(envelope({ session_id: "session-2" })));

    const { result, sessionId } = await invokeAgent(BASE_INVOCATION, { runAgentProcess });

    expect(result).toEqual({ ok: true });
    expect(sessionId).toBe("session-2");
    expect(runAgentProcess).toHaveBeenCalledTimes(2);
    const [retryArgs, retryInput] = runAgentProcess.mock.calls[1] ?? [];
    expect(retryArgs).toContain("--resume");
    expect((retryArgs as string[])[(retryArgs as string[]).indexOf("--resume") + 1]).toBe(
      "session-1",
    );
    expect(retryInput).toMatch(/did not parse as JSON matching the required schema/);
  });

  it("retries once when structured_output is missing entirely", async () => {
    const runAgentProcess = vi
      .fn()
      .mockResolvedValueOnce(
        processResult(JSON.stringify({ result: "no schema here", session_id: "s1" })),
      )
      .mockResolvedValueOnce(processResult(envelope()));

    const { result } = await invokeAgent(BASE_INVOCATION, { runAgentProcess });

    expect(result).toEqual({ ok: true });
    expect(runAgentProcess).toHaveBeenCalledTimes(2);
  });

  it("throws AgentOutputError when the retry also fails validation", async () => {
    const invalid = envelope({ structured_output: { ok: "nope" } });
    const runAgentProcess = vi.fn(async () => processResult(invalid));

    await expect(invokeAgent(BASE_INVOCATION, { runAgentProcess })).rejects.toThrow(
      AgentOutputError,
    );
    expect(runAgentProcess).toHaveBeenCalledTimes(2);
  });

  it("throws AgentOutputError on unparseable stdout", async () => {
    const runAgentProcess = vi.fn(async () => processResult("not json"));

    await expect(invokeAgent(BASE_INVOCATION, { runAgentProcess })).rejects.toThrow(
      AgentOutputError,
    );
  });

  it("propagates process-level errors without retrying", async () => {
    const runAgentProcess = vi.fn(async () => {
      throw new AgentBinaryMissingError("claude", "install Claude Code");
    });

    await expect(invokeAgent(BASE_INVOCATION, { runAgentProcess })).rejects.toThrow(
      AgentBinaryMissingError,
    );
    expect(runAgentProcess).toHaveBeenCalledTimes(1);
  });

  it("logs each call's model, turn count and duration at debug level", async () => {
    const runAgentProcess = vi.fn(async () =>
      processResult(envelope({ num_turns: 4, duration_ms: 63_000 })),
    );
    const write = vi.fn();
    const logger = createLogger({ write, verbose: true });

    await invokeAgent(BASE_INVOCATION, { runAgentProcess, logger });

    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toMatch(/\[DEBUG\] claude sonnet: 4 turn\(s\), 1m3s$/);
  });

  it("logs the retry as a resume, printing ? for envelope fields the CLI omitted", async () => {
    const runAgentProcess = vi
      .fn()
      .mockResolvedValueOnce(
        processResult(
          envelope({ structured_output: { ok: "nope" }, num_turns: 1, duration_ms: 2_000 }),
        ),
      )
      .mockResolvedValueOnce(processResult(envelope({ session_id: "session-2" })));
    const write = vi.fn();
    const logger = createLogger({ write, verbose: true });

    await invokeAgent(BASE_INVOCATION, { runAgentProcess, logger });

    const lines = write.mock.calls.map((call) => String(call[0]));
    expect(lines[0]).toMatch(/claude sonnet: 1 turn\(s\), 2s$/);
    expect(lines[1]).toMatch(/claude resume: \? turn\(s\), \?$/);
  });

  it("files a resume of an unrecorded session under 'unknown' in the usage ledger", async () => {
    const runAgentProcess = vi.fn(async () =>
      processResult(envelope({ usage: { input_tokens: 5, output_tokens: 5 } })),
    );
    const usage = createUsageLedger();

    await invokeAgent(
      { resumeSessionId: "never-seen", schema: SCHEMA, prompt: "follow up" },
      { runAgentProcess, usage, agent: createAgent("claude") },
    );

    expect(usage.rows()).toEqual([
      { model: "unknown", tokens: { input: 5, output: 5, cacheWrite: 0, cacheRead: 0 } },
    ]);
  });

  it("never runs more than 3 agent processes concurrently", async () => {
    let inFlight = 0;
    let peak = 0;
    const runAgentProcess = vi.fn(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return processResult(envelope());
    });

    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        invokeAgent({ ...BASE_INVOCATION, prompt: `task ${i}` }, { runAgentProcess }),
      ),
    );

    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBe(3);
  });
});

describe("invokeAgent with the cursor backend", () => {
  function cursorEnvelope(result: string, sessionId = "chat-1"): string {
    return JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 1000,
      result,
      session_id: sessionId,
      usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 30, cacheWriteTokens: 4 },
    });
  }

  it("parses the JSON out of the reply text, records usage under the cursor model id", async () => {
    const runAgentProcess = vi.fn(async (_args: string[], _input: string) =>
      processResult(cursorEnvelope('I checked the files.{"ok": true}')),
    );
    const usage = createUsageLedger();

    const { result, sessionId } = await invokeAgent(BASE_INVOCATION, {
      runAgentProcess,
      usage,
      agent: createAgent("cursor-anthropic"),
    });

    expect(result).toEqual({ ok: true });
    expect(sessionId).toBe("chat-1");
    const [args, input] = runAgentProcess.mock.calls[0] ?? [];
    expect(args).toEqual([
      "-p",
      "--output-format",
      "json",
      "--mode",
      "ask",
      "--trust",
      "--model",
      config.agents["cursor-anthropic"].models.balanced,
    ]);
    expect(input).toContain("do the thing");
    expect(input).toContain(JSON.stringify(SCHEMA));
    expect(usage.rows()).toEqual([
      {
        model: config.agents["cursor-anthropic"].models.balanced,
        tokens: { input: 10, output: 2, cacheWrite: 4, cacheRead: 30 },
      },
    ]);
  });

  it("retries by resuming the session with the same model when the reply has no JSON", async () => {
    const runAgentProcess = vi
      .fn()
      .mockResolvedValueOnce(processResult(cursorEnvelope("Sorry, here is prose only.")))
      .mockResolvedValueOnce(processResult(cursorEnvelope('```json\n{"ok": false}\n```')));

    const { result } = await invokeAgent(BASE_INVOCATION, {
      runAgentProcess,
      agent: createAgent("cursor-anthropic"),
    });

    expect(result).toEqual({ ok: false });
    expect(runAgentProcess).toHaveBeenCalledTimes(2);
    const [retryArgs, retryInput] = runAgentProcess.mock.calls[1] ?? [];
    expect(retryArgs).toContain("--resume");
    expect((retryArgs as string[])[(retryArgs as string[]).indexOf("--resume") + 1]).toBe("chat-1");
    expect((retryArgs as string[])[(retryArgs as string[]).indexOf("--model") + 1]).toBe(
      config.agents["cursor-anthropic"].models.balanced,
    );
    expect(retryInput).toMatch(/no structured output in cursor-anthropic's response/);
    expect(retryInput).toContain(JSON.stringify(SCHEMA));
  });
});

describe("invokeAgent with the codex backend", () => {
  function codexStdout(text: string): string {
    return [
      JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text },
      }),
      JSON.stringify({
        type: "turn.completed",
        usage: {
          input_tokens: 10,
          output_tokens: 2,
          cache_write_input_tokens: 4,
          cached_input_tokens: 30,
        },
      }),
    ].join("\n");
  }

  it("writes the schema file before the process and removes it after", async () => {
    let schemaPath: string | undefined;
    const runAgentProcess = vi.fn(async (args: string[], input: string) => {
      const index = args.indexOf("--output-schema");
      schemaPath = args[index + 1];
      expect(schemaPath).toBeDefined();
      expect(await readFile(schemaPath ?? "", "utf8")).toBe(JSON.stringify(SCHEMA));
      expect(input).toBe("do the thing");
      expect(args.at(-1)).toBe("-");
      return processResult(codexStdout('{"ok": true}'));
    });

    const { result, sessionId } = await invokeAgent(BASE_INVOCATION, {
      runAgentProcess,
      agent: createAgent("codex"),
    });

    expect(result).toEqual({ ok: true });
    expect(sessionId).toBe("thread-1");
    await expect(readFile(schemaPath ?? "", "utf8")).rejects.toThrow();
  });

  it("removes the schema file when the process fails", async () => {
    let schemaPath: string | undefined;
    const runAgentProcess = vi.fn(async (args: string[]) => {
      schemaPath = args[args.indexOf("--output-schema") + 1];
      expect(await readFile(schemaPath ?? "", "utf8")).toBe(JSON.stringify(SCHEMA));
      throw new Error("codex exited");
    });

    await expect(
      invokeAgent(BASE_INVOCATION, { runAgentProcess, agent: createAgent("codex") }),
    ).rejects.toThrow("codex exited");
    await expect(readFile(schemaPath ?? "", "utf8")).rejects.toThrow();
  });
});
