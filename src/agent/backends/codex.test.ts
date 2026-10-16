import { lstat, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentOutputError } from "../errors.js";
import type { JsonSchema } from "../schema.js";
import { codexBackend } from "./codex.js";

const SCHEMA: JsonSchema = {
  type: "object",
  required: ["ok"],
  properties: { ok: { type: "boolean" } },
};

const FORBIDDEN = [
  "--yolo",
  "--dangerously-bypass-approvals-and-sandbox",
  "--dangerously-bypass-hook-trust",
  "--approve-for-me",
  "workspace-write",
  "danger-full-access",
];

function jsonl(events: Record<string, unknown>[]): string {
  return events.map((event) => JSON.stringify(event)).join("\n");
}

function plan(overrides: { model?: string; resumeSessionId?: string } = {}) {
  const spawn = codexBackend.planSpawn({
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
  it("runs exec read-only, with the schema file and stdin as the prompt", () => {
    const spawn = plan();

    expect(spawn.file.path).toMatch(/tulip-codex-.+\.json$/);
    expect(spawn.file.path.startsWith(tmpdir())).toBe(true);
    expect(spawn.file.contents).toBe(JSON.stringify(SCHEMA));
    expect(spawn.prompt).toBe("do the thing");
    expect(spawn.args).toEqual([
      "exec",
      "--json",
      "--sandbox",
      "read-only",
      "--ask-for-approval",
      "never",
      "--model",
      "m1",
      "--output-schema",
      spawn.file.path,
      "-",
    ]);
  });

  it("passes --model on a resume, with the thread id before the stdin marker", () => {
    const spawn = plan({ resumeSessionId: "thread-1" });

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

  it("uses a fresh schema file per call", () => {
    const first = plan();
    const second = plan();

    expect(first.file.path).not.toBe(second.file.path);
  });

  it("never widens the sandbox or bypasses hook trust", () => {
    const { args } = plan({ resumeSessionId: "thread-1" });

    for (const flag of FORBIDDEN) {
      expect(args).not.toContain(flag);
    }
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
    );

    expect(reply.sessionId).toBe("thread-1");
    expect(reply.text).toBe('{"ok": true}');
    expect(reply.structured).toEqual({ ok: true });
    expect(reply.usage).toEqual({ input: 10, output: 2, cacheWrite: 3, cacheRead: 4 });
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
    );

    expect(reply.sessionId).toBe("thread-2");
    expect(reply.structured).toBeUndefined();
  });

  it("throws AgentOutputError when a turn fails", () => {
    expect(() =>
      codexBackend.parseReply(
        jsonl([
          { type: "thread.started", thread_id: "thread-1" },
          { type: "turn.failed", error: { message: "boom" } },
        ]),
      ),
    ).toThrow(/reported an error: boom/);
  });

  it("throws AgentOutputError on an error event", () => {
    expect(() => codexBackend.parseReply(jsonl([{ type: "error", message: "nope" }]))).toThrow(
      AgentOutputError,
    );
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
      ),
    ).toThrow(/missing string "thread_id"/);
  });

  it("throws AgentOutputError on a non-JSON line", () => {
    expect(() => codexBackend.parseReply("not json\n")).toThrow(/unparseable output/);
  });
});

describe("codexBackend.prepareWorkspace", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("removes repo-controlled .codex config, leaving everything else", async () => {
    dir = await mkdtemp(join(tmpdir(), "tulip-codex-ws-"));
    await mkdir(join(dir, ".codex"));
    await writeFile(join(dir, ".codex", "config.toml"), "");
    await writeFile(join(dir, "AGENTS.md"), "keep");

    await codexBackend.prepareWorkspace?.(dir);

    expect(await readdir(dir)).toEqual(["AGENTS.md"]);
  });

  it("unlinks a symlinked .codex without touching its target", async () => {
    dir = await mkdtemp(join(tmpdir(), "tulip-codex-ws-"));
    const outside = join(dir, "outside");
    const checkout = join(dir, "checkout");
    await mkdir(outside);
    await writeFile(join(outside, "keep.txt"), "keep");
    await mkdir(checkout);
    await symlink(outside, join(checkout, ".codex"));

    await codexBackend.prepareWorkspace?.(checkout);

    await expect(lstat(join(checkout, ".codex"))).rejects.toThrow();
    expect(await readdir(outside)).toEqual(["keep.txt"]);
  });

  it("is a no-op when .codex does not exist", async () => {
    dir = await mkdtemp(join(tmpdir(), "tulip-codex-ws-"));

    await expect(codexBackend.prepareWorkspace?.(dir)).resolves.toBeUndefined();
  });
});
