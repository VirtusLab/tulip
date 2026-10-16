import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../../config.js";
import type { AgentBackend, AgentCallArgs, AgentReply, AgentSpawnPlan } from "../backend.js";
import { AgentOutputError } from "../errors.js";
import { isPlainObject } from "../schema.js";
import { extractJson, replyFrom, truncate } from "../util.js";

/**
 * OpenAI Codex's headless `codex exec` (docs/adr/0027). `--json` prints a JSONL event stream
 * rather than one envelope. `--output-schema` takes a file path, so {@link planSpawn} puts the
 * schema in a temp file instead of argv; the prompt stays on stdin, and argv ends with `-` so
 * stdin is the prompt rather than extra context next to a prompt argument.
 *
 * `--sandbox read-only` is explicit (it overrides user config) and `--ask-for-approval never`
 * keeps a command approval from hanging until the process timeout. Never `--yolo`,
 * `danger-full-access`, `workspace-write`, `--approve-for-me`, or
 * `--dangerously-bypass-hook-trust`.
 */
export const codexBackend: AgentBackend = {
  id: "codex",
  label: "Codex CLI",
  bin: config.agents.codex.bin,
  installHint: "install the Codex CLI (https://developers.openai.com/codex) and run `codex login`",
  modelFor: (tier) => config.agents.codex.models[tier],
  buildArgs: (call) => spawnArgs(call, schemaFilePath()),
  preparePrompt: (prompt) => prompt,
  planSpawn,
  parseReply,
  prepareWorkspace,
};

function planSpawn(call: AgentCallArgs & { prompt: string }): AgentSpawnPlan {
  const path = schemaFilePath();
  return {
    args: spawnArgs(call, path),
    prompt: call.prompt,
    files: [{ path, contents: JSON.stringify(call.schema) }],
  };
}

function schemaFilePath(): string {
  return join(tmpdir(), `tulip-codex-${randomUUID()}.json`);
}

function spawnArgs(call: AgentCallArgs, schemaPath: string): string[] {
  const args = ["exec", "--json", "--sandbox", "read-only", "--ask-for-approval", "never"];
  if (call.model) {
    args.push("--model", call.model);
  }
  args.push("--output-schema", schemaPath);
  if (call.resumeSessionId) {
    args.push("resume", call.resumeSessionId);
  }
  args.push("-");
  return args;
}

/**
 * Reads the JSONL stream: the session id is the last `thread.started` `thread_id`, the text is
 * the last completed `agent_message` (intermediate messages can be schema-shaped too), and usage
 * is the last `turn.completed`. `reasoning_output_tokens` is ignored so it isn't added on top of
 * `output_tokens`.
 */
function parseReply(stdout: string): AgentReply {
  let sessionId: string | undefined;
  let text = "";
  let usage: unknown;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const event = parseEvent(trimmed);
    if (event.type === "turn.failed" || event.type === "error") {
      throw new AgentOutputError(`codex reported an error: ${truncate(eventMessage(event))}`);
    }
    if (event.type === "thread.started" && typeof event.thread_id === "string") {
      sessionId = event.thread_id;
    }
    if (
      event.type === "item.completed" &&
      isPlainObject(event.item) &&
      event.item.type === "agent_message" &&
      typeof event.item.text === "string"
    ) {
      text = event.item.text;
    }
    if (event.type === "turn.completed") {
      usage = event.usage;
    }
  }
  if (sessionId === undefined) {
    throw new AgentOutputError(`codex's output is missing string "thread_id": ${truncate(stdout)}`);
  }
  return replyFrom(
    { sessionId, text, fields: isPlainObject(usage) ? { usage } : {} },
    extractJson(text),
    {
      input: "input_tokens",
      output: "output_tokens",
      cacheWrite: "cache_write_input_tokens",
      cacheRead: "cached_input_tokens",
    },
  );
}

function parseEvent(line: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new AgentOutputError(`codex produced unparseable output: ${truncate(line)}`);
  }
  if (!isPlainObject(parsed) || typeof parsed.type !== "string") {
    throw new AgentOutputError(`codex produced an unexpected event: ${truncate(line)}`);
  }
  return parsed;
}

function eventMessage(event: Record<string, unknown>): string {
  const { error, message } = event;
  if (typeof error === "string") return error;
  if (isPlainObject(error) && typeof error.message === "string") return error.message;
  if (typeof message === "string") return message;
  return JSON.stringify(event);
}

/** `rm` with `force` unlinks a symlinked dir without following it, so nothing outside the
 * checkout is touched. */
async function prepareWorkspace(dir: string): Promise<void> {
  await rm(join(dir, ".codex"), { recursive: true, force: true });
}
