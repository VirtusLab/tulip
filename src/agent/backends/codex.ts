import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../../config.js";
import { AgentOutputError, truncate } from "../errors.js";
import { isPlainObject, type JsonSchema } from "../schema.js";
import type { AgentBackend, AgentCallArgs, AgentReply, AgentSpawnPlan } from "../types.js";
import { findCodexExecutable, sandboxReadDirs } from "./codex-install.js";
import { stripOptionalNulls, toStrictSchema } from "./codex-schema.js";
import { extractJson } from "./extract-json.js";
import { readUsage } from "./usage-fields.js";

/**
 * OpenAI Codex's headless `codex exec` (docs/adr/0028). `--json` prints a JSONL event stream
 * rather than one envelope. `--output-schema` takes a file path, so {@link planSpawn} puts the
 * schema in a temp file instead of argv; the prompt stays on stdin, and argv ends with `-` so
 * stdin is the prompt rather than extra context next to a prompt argument.
 *
 * Codex's shell is the model's only way to read the checkout, so instead of a tool allowlist the
 * shell is confined (docs/adr/0002): a permission profile that can read only the checkout and
 * system dirs, no network, and no secret-looking env vars. Server-side tools (web search, apps,
 * plugins) bypass that sandbox, so they're off, and `--ignore-user-config` keeps the user's MCP
 * servers and feature flags out. Never `--yolo`, `--sandbox`, `--approve-for-me`, or
 * `--dangerously-bypass-*`. `findExecutable` resolves the native binary the profile must also
 * let the sandbox read (./codex-install.ts).
 */
const INSTALL_HINT =
  "install the Codex CLI (https://developers.openai.com/codex) and run `codex login`";

export function createCodexBackend(findExecutable: () => Promise<string>): AgentBackend {
  return {
    id: "codex",
    installHint: INSTALL_HINT,
    repoConfigDirs: [".codex"],
    planSpawn: async (call) => planSpawn(call, sandboxReadDirs(await findExecutable())),
    parseReply,
    describeFailure,
    usageIsSessionTotal: true,
  };
}

let executable: Promise<string> | undefined;

/** Looks up Codex's executable once per process; a failed lookup is retried on the next call. */
export const codexBackend = createCodexBackend(() => {
  executable ??= findCodexExecutable(config.agents.codex.bin, INSTALL_HINT).catch(
    (error: unknown) => {
      executable = undefined;
      throw error;
    },
  );
  return executable;
});

/** The permission profile's name; `--ignore-user-config` means no user profile can clash. */
const PROFILE = "tulip";

function planSpawn(call: AgentCallArgs, readDirs: string[]): AgentSpawnPlan {
  const path = join(tmpdir(), `tulip-codex-${randomUUID()}.json`);
  // `--ask-for-approval` and `-c`/`--disable` are top-level options, so they precede `exec`.
  const args = [
    "--ask-for-approval",
    "never",
    "-c",
    `default_permissions=${JSON.stringify(PROFILE)}`,
    "-c",
    `permissions.${PROFILE}.filesystem=${filesystemToml(readDirs)}`,
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
  ];
  if (call.model) {
    args.push("--model", call.model);
  }
  args.push("--output-schema", path);
  if (call.resumeSessionId) {
    args.push("resume", call.resumeSessionId);
  }
  args.push("-");
  return {
    args,
    prompt: call.prompt,
    files: [{ path, contents: JSON.stringify(toStrictSchema(call.schema)) }],
  };
}

/**
 * The profile's readable paths, as an inline TOML table: the checkout (Codex's workspace root),
 * `:minimal` (what a shell needs to start), and `readDirs`. Anything else, the home dir
 * included, isn't visible to the model's commands. TOML basic strings accept JSON escapes.
 */
function filesystemToml(readDirs: string[]): string {
  const entries = [
    '":minimal"="read"',
    '":workspace_roots"={"."="read"}',
    ...readDirs.map((dir) => `${JSON.stringify(dir)}="read"`),
  ];
  return `{${entries.join(", ")}}`;
}

/**
 * Reads the JSONL stream: the session id is the last `thread.started` `thread_id`, the text is
 * the last completed `agent_message` (intermediate messages can be schema-shaped too), and usage
 * is the last `turn.completed` — the thread's running total, hence `usageIsSessionTotal`.
 * `input_tokens` includes `cached_input_tokens`, so the uncached input is their difference;
 * `output_tokens` already includes `reasoning_output_tokens`.
 */
function parseReply(stdout: string, schema: JsonSchema): AgentReply {
  let sessionId: string | undefined;
  let text = "";
  let usage: unknown;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const event = parseEvent(trimmed);
    // A top-level `error` can be a transient notice ("Reconnecting... 2/5") in a turn that then
    // completes; only `turn.failed` ends the turn.
    if (event.type === "turn.failed") {
      throw new AgentOutputError(`codex reported an error: ${truncate(eventMessage(event))}`);
    }
    const unreadable = unreadableExecutable(event);
    if (unreadable !== undefined) {
      throw new AgentOutputError(
        `codex's sandbox can't read its own executable ${unreadable}, so the model can't run ` +
          "commands. Tulip lets it read the executable `codex doctor --json` reports; check " +
          "that the `codex` on PATH reports this one.",
      );
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
  const extracted = extractJson(text);
  const reply: AgentReply = {
    sessionId,
    text,
    structured: extracted === undefined ? undefined : stripOptionalNulls(extracted, schema),
  };
  const tokens = readUsage(usage, {
    input: "input_tokens",
    output: "output_tokens",
    cacheWrite: "cache_write_input_tokens",
    cacheRead: "cached_input_tokens",
  });
  if (tokens !== undefined) {
    reply.usage = { ...tokens, input: Math.max(0, tokens.input - tokens.cacheRead) };
  }
  return reply;
}

/** The binary path in a command's "bwrap: execvp <path>: No such file or directory" output: the
 * sandbox couldn't read Codex's executable (see ./codex-install.ts). Codex itself still exits 0. */
function unreadableExecutable(event: Record<string, unknown>): string | undefined {
  const { item } = event;
  if (
    event.type !== "item.completed" ||
    !isPlainObject(item) ||
    item.type !== "command_execution" ||
    typeof item.aggregated_output !== "string"
  ) {
    return undefined;
  }
  return /^bwrap: execvp (.+): No such file or directory/.exec(item.aggregated_output)?.[1];
}

/** The last `turn.failed`/`error` event's message: on failure Codex exits 1 with nothing on
 * stderr. */
function describeFailure(stdout: string): string | undefined {
  let message: string | undefined;
  for (const line of stdout.split("\n")) {
    let event: Record<string, unknown>;
    try {
      event = parseEvent(line.trim());
    } catch {
      continue;
    }
    if (event.type === "turn.failed" || event.type === "error") {
      message = eventMessage(event);
    }
  }
  return message;
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

/** An API error arrives as its whole JSON response body; that body's `error.message` is the
 * readable part. */
function eventMessage(event: Record<string, unknown>): string {
  const text = rawEventMessage(event);
  const body = tryParseObject(text);
  return isPlainObject(body?.error) && typeof body.error.message === "string"
    ? body.error.message
    : text;
}

function rawEventMessage(event: Record<string, unknown>): string {
  const { error, message } = event;
  if (typeof error === "string") return error;
  if (isPlainObject(error) && typeof error.message === "string") return error.message;
  if (typeof message === "string") return message;
  return JSON.stringify(event);
}

function tryParseObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
