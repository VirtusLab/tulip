import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { JsonSchema } from "../schema.js";
import { codexBackend, createCodexBackend } from "./codex.js";
import { findCodexExecutable } from "./codex-install.js";
import { toStrictSchema } from "./codex-schema.js";

const SCHEMA: JsonSchema = {
  type: "object",
  required: ["ok"],
  properties: { ok: { type: "boolean" } },
};

const FORBIDDEN = [
  "--yolo",
  "--sandbox",
  "--dangerously-bypass-approvals-and-sandbox",
  "--dangerously-bypass-hook-trust",
  "--approve-for-me",
  "workspace-write",
  "danger-full-access",
];

vi.mock("./codex-install.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./codex-install.js")>()),
  findCodexExecutable: vi.fn(),
}));

function jsonl(events: Record<string, unknown>[]): string {
  return events.map((event) => JSON.stringify(event)).join("\n");
}

/** Codex's executable as `codex doctor --json` would report it; no helper dirs exist next to it. */
const EXECUTABLE = "/opt/codex/bin/codex";

const backend = createCodexBackend(async () => EXECUTABLE);

async function plan(overrides: { model?: string; resumeSessionId?: string } = {}) {
  const spawn = await backend.planSpawn({
    schema: SCHEMA,
    prompt: "do the thing",
    model: overrides.model ?? "m1",
    ...(overrides.resumeSessionId === undefined
      ? {}
      : { resumeSessionId: overrides.resumeSessionId }),
  });
  const file = spawn.files[0];
  if (file === undefined) {
    throw new Error("codex planSpawn did not return a schema file");
  }
  return { args: spawn.args, prompt: spawn.prompt, file };
}

describe("codexBackend.planSpawn", () => {
  it("confines the shell, turns off server-side tools, and sends the strict schema file", async () => {
    const spawn = await plan();

    expect(spawn.file.path).toMatch(/tulip-codex-.+\.json$/);
    expect(spawn.file.path.startsWith(tmpdir())).toBe(true);
    expect(spawn.file.contents).toBe(JSON.stringify(toStrictSchema(SCHEMA)));
    expect(spawn.prompt).toBe("do the thing");
    expect(spawn.args).toEqual([
      "--ask-for-approval",
      "never",
      "-c",
      'default_permissions="tulip"',
      "-c",
      'permissions.tulip.filesystem={":minimal"="read", ":workspace_roots"={"."="read"}, "/opt/codex/bin"="read"}',
      "-c",
      'shell_environment_policy.inherit="core"',
      "-c",
      'web_search="disabled"',
      "--disable",
      "apps",
      "--disable",
      "plugins",
      "exec",
      "--json",
      "--ignore-user-config",
      "--model",
      "m1",
      "--output-schema",
      spawn.file.path,
      "-",
    ]);
  });

  it("passes --model on a resume, with the thread id before the stdin marker", async () => {
    const spawn = await plan({ resumeSessionId: "thread-1" });

    expect(spawn.args.slice(-7)).toEqual([
      "--model",
      "m1",
      "--output-schema",
      spawn.file.path,
      "resume",
      "thread-1",
      "-",
    ]);
  });

  it("omits --model on a resume of an unknown session", async () => {
    const { args } = await backend.planSpawn({
      schema: SCHEMA,
      prompt: "do the thing",
      resumeSessionId: "thread-1",
    });

    expect(args).not.toContain("--model");
    expect(args.slice(-3)).toEqual(["resume", "thread-1", "-"]);
  });

  it("uses a fresh schema file per call", async () => {
    const first = await plan();
    const second = await plan();

    expect(first.file.path).not.toBe(second.file.path);
  });

  it("never widens the sandbox or bypasses hook trust", async () => {
    const { args } = await plan({ resumeSessionId: "thread-1" });

    for (const flag of FORBIDDEN) {
      expect(args).not.toContain(flag);
    }
  });
});

describe("codexBackend's executable lookup", () => {
  it("is cached once it succeeds, and retried after a failure", async () => {
    const lookup = vi
      .mocked(findCodexExecutable)
      .mockRejectedValueOnce(new Error("doctor failed"))
      .mockResolvedValue(EXECUTABLE);
    const call = { schema: SCHEMA, prompt: "p", model: "m1" };

    await expect(codexBackend.planSpawn(call)).rejects.toThrow("doctor failed");
    await expect(codexBackend.planSpawn(call)).resolves.toBeDefined();
    await expect(codexBackend.planSpawn(call)).resolves.toBeDefined();

    expect(lookup).toHaveBeenCalledTimes(2);
  });
});

describe("codexBackend.parseReply", () => {
  it("maps the last agent message, thread id, and turn usage", () => {
    const reply = codexBackend.parseReply(
      jsonl([
        { type: "thread.started", thread_id: "thread-1" },
        { type: "turn.started" },
        {
          type: "item.completed",
          item: { id: "item_1", type: "agent_message", text: '{"ok": false}' },
        },
        {
          type: "item.completed",
          item: { id: "item_2", type: "agent_message", text: '{"ok": true}' },
        },
        {
          type: "turn.completed",
          usage: {
            input_tokens: 10,
            cached_input_tokens: 4,
            cache_write_input_tokens: 3,
            output_tokens: 2,
            reasoning_output_tokens: 99,
          },
        },
      ]),
      SCHEMA,
    );

    expect(reply.sessionId).toBe("thread-1");
    expect(reply.text).toBe('{"ok": true}');
    expect(reply.structured).toEqual({ ok: true });
    // input_tokens includes the cached ones; output_tokens already includes reasoning.
    expect(reply.usage).toEqual({ input: 6, output: 2, cacheWrite: 3, cacheRead: 4 });
  });

  it("keeps the last thread id when a resume emits another thread.started", () => {
    const reply = codexBackend.parseReply(
      jsonl([
        { type: "thread.started", thread_id: "old" },
        { type: "thread.started", thread_id: "thread-2" },
        {
          type: "item.completed",
          item: { type: "agent_message", text: "just prose" },
        },
      ]),
      SCHEMA,
    );

    expect(reply.sessionId).toBe("thread-2");
    expect(reply.structured).toBeUndefined();
  });

  it("reads the reply from the last agent message, not a later item of another type", () => {
    const reply = codexBackend.parseReply(
      jsonl([
        { type: "thread.started", thread_id: "thread-1" },
        { type: "item.completed", item: { type: "agent_message", text: '{"ok": true}' } },
        { type: "item.completed", item: { type: "reasoning", text: '{"ok": false}' } },
      ]),
      SCHEMA,
    );

    expect(reply.structured).toEqual({ ok: true });
  });

  it("leaves usage undefined when no turn.completed was emitted", () => {
    const reply = codexBackend.parseReply(
      jsonl([
        { type: "thread.started", thread_id: "thread-1" },
        { type: "item.completed", item: { type: "agent_message", text: '{"ok": true}' } },
      ]),
      SCHEMA,
    );

    expect(reply.usage).toBeUndefined();
  });

  it("throws AgentOutputError when a turn fails", () => {
    expect(() =>
      codexBackend.parseReply(
        jsonl([
          { type: "thread.started", thread_id: "thread-1" },
          { type: "turn.failed", error: { message: "boom" } },
        ]),
        SCHEMA,
      ),
    ).toThrow(/reported an error: boom/);
  });

  it("tolerates transient error events in a turn that then completes", () => {
    const reply = codexBackend.parseReply(
      jsonl([
        { type: "thread.started", thread_id: "thread-1" },
        { type: "error", message: "Reconnecting... 1/5 (stream disconnected)" },
        { type: "error", message: "Reconnecting... 2/5 (stream disconnected)" },
        { type: "item.completed", item: { type: "agent_message", text: '{"ok": true}' } },
        { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } },
      ]),
      SCHEMA,
    );

    expect(reply.structured).toEqual({ ok: true });
  });

  it("fails loudly when the sandbox couldn't run Codex's own executable", () => {
    expect(() =>
      codexBackend.parseReply(
        jsonl([
          { type: "thread.started", thread_id: "thread-1" },
          {
            type: "item.completed",
            item: {
              type: "command_execution",
              command: "/bin/bash -lc 'cat a.txt'",
              aggregated_output: "bwrap: execvp /x/vendor/bin/codex: No such file or directory\n",
              exit_code: 1,
            },
          },
          { type: "item.completed", item: { type: "agent_message", text: '{"ok": true}' } },
        ]),
        SCHEMA,
      ),
    ).toThrow(/can't read its own executable \/x\/vendor\/bin\/codex/);
  });

  it("throws AgentOutputError when no thread id was emitted", () => {
    expect(() =>
      codexBackend.parseReply(
        jsonl([
          {
            type: "item.completed",
            item: { type: "agent_message", text: '{"ok": true}' },
          },
        ]),
        SCHEMA,
      ),
    ).toThrow(/missing string "thread_id"/);
  });

  it("throws AgentOutputError on a non-JSON line", () => {
    expect(() => codexBackend.parseReply("not json\n", SCHEMA)).toThrow(/unparseable output/);
  });
});

describe("codexBackend.describeFailure", () => {
  it("returns the last failure's API error message, unwrapped from its response body", () => {
    const body = (message: string) =>
      JSON.stringify({
        type: "error",
        error: { message, type: "invalid_request_error" },
        status: 400,
      });

    const message = codexBackend.describeFailure?.(
      jsonl([
        { type: "thread.started", thread_id: "thread-1" },
        { type: "error", message: body("first") },
        { type: "turn.failed", error: { message: body("Invalid schema") } },
      ]),
    );

    expect(message).toBe("Invalid schema");
  });

  it("returns a message that isn't a JSON body as is", () => {
    expect(
      codexBackend.describeFailure?.(jsonl([{ type: "turn.failed", error: { message: "boom" } }])),
    ).toBe("boom");
  });

  it("returns undefined when stdout reports no failure", () => {
    expect(
      codexBackend.describeFailure?.(
        `${jsonl([{ type: "thread.started", thread_id: "t" }])}\nnoise`,
      ),
    ).toBeUndefined();
  });
});
