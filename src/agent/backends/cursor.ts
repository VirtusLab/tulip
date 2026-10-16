import { rm } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../../config.js";
import { renderPrompt } from "../../prompts/loader.js";
import { findFences } from "../../rendering/fences.js";
import type { AgentBackend, AgentCallArgs, AgentReply } from "../backend.js";
import { AgentOutputError } from "../errors.js";
import type { JsonSchema } from "../schema.js";
import { parseEnvelope, replyFrom, truncate } from "../util.js";

/**
 * Checkout-relative dirs Cursor's `agent` loads config from, removed by `prepareWorkspace`.
 * `--trust` (required headless) lets project config run unprompted, and both were verified to
 * execute a PR's hooks: `.cursor/hooks.json`, and Claude Code's `.claude/settings.json` hooks,
 * which Cursor also honors (docs/adr/0026).
 */
const REPO_CONFIG_DIRS = [".cursor", ".claude"];

/**
 * Cursor's headless `agent -p`. It has no native structured output, so the schema is appended to
 * every prompt and the JSON is parsed out of the reply text; `invokeAgent` validates it as for any
 * other backend. Its `--output-format json` envelope's camelCase `usage` isn't in Cursor's
 * published docs but is present in practice (docs/adr/0026).
 *
 * `--mode ask` is the CLI's read-only mode: `-p` alone grants write and shell tools, which a
 * prompt-injected PR could use (see docs/adr/0002 for why tulip grants no command execution).
 * `--trust` skips the workspace-trust prompt that otherwise aborts a headless run in the fresh
 * checkout dir. `--force`/`--yolo`/`--approve-mcps` must never be added.
 */
export const cursorBackend: AgentBackend = {
  id: "cursor",
  label: "Cursor CLI",
  bin: config.agents.cursor.bin,
  installHint: "install the Cursor CLI (https://cursor.com/cli) and run `agent login`",
  modelFor: (tier) => config.agents.cursor.models[tier],
  buildArgs,
  preparePrompt,
  parseReply,
  prepareWorkspace,
};

function buildArgs(call: AgentCallArgs): string[] {
  const args = ["-p", "--output-format", "json", "--mode", "ask", "--trust"];
  // Passed on resumes too: unlike `claude --resume`, nothing guarantees the session's model is
  // kept, and each session's model is known (see `Agent.sessionTiers`).
  if (call.model) {
    args.push("--model", call.model);
  }
  if (call.resumeSessionId) {
    args.push("--resume", call.resumeSessionId);
  }
  return args;
}

function preparePrompt(prompt: string, schema: JsonSchema): string {
  return `${prompt}\n\n${renderPrompt("structured-output", { schema: JSON.stringify(schema) })}`;
}

function parseReply(stdout: string): AgentReply {
  const envelope = parseEnvelope(stdout, "cursor");
  if (envelope.fields.is_error === true) {
    throw new AgentOutputError(`cursor reported an error: ${truncate(envelope.text)}`);
  }
  return replyFrom(envelope, extractJson(envelope.text), {
    input: "inputTokens",
    output: "outputTokens",
    cacheWrite: "cacheWriteTokens",
    cacheRead: "cacheReadTokens",
  });
}

/**
 * The JSON value in a reply's text, or `undefined` if none parses. `result` concatenates every
 * assistant message of the turn (e.g. "I'll read the file.{...}"), so besides the whole text this
 * tries each fenced code block (last first), then each `{...}` span from the left — the leftmost
 * one that parses is the outermost object. A balanced span that doesn't parse is skipped whole,
 * so a malformed reply costs one pass, not one per nested brace.
 */
export function extractJson(text: string): unknown {
  const whole = tryParse(text.trim());
  if (whole !== undefined) {
    return whole;
  }
  for (const fence of findFences(text).reverse()) {
    const value = tryParse(fence.content.trim());
    if (value !== undefined) {
      return value;
    }
  }
  let start = text.indexOf("{");
  while (start !== -1) {
    const end = matchingBrace(text, start);
    if (end === -1) {
      start = text.indexOf("{", start + 1);
      continue;
    }
    const value = tryParse(text.slice(start, end + 1));
    if (value !== undefined) {
      return value;
    }
    start = text.indexOf("{", end + 1);
  }
  return undefined;
}

function tryParse(candidate: string): unknown {
  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}

/** Index of the `}` closing the `{` at `start`, skipping braces inside JSON strings; -1 if none. */
function matchingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") {
        i++;
      } else if (ch === '"') {
        inString = false;
      }
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/** `rm` with `force` unlinks a symlinked dir without following it, so nothing outside the
 * checkout is touched. */
async function prepareWorkspace(dir: string): Promise<void> {
  await Promise.all(
    REPO_CONFIG_DIRS.map((name) => rm(join(dir, name), { recursive: true, force: true })),
  );
}
