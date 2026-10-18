import { renderPrompt } from "../../prompts/loader.js";
import type { AgentBackend, AgentCallArgs, AgentId, AgentReply, AgentSpawnPlan } from "../types.js";
import { parseEnvelope, replyFrom } from "./envelope.js";
import { extractJson } from "./extract-json.js";

/**
 * Checkout-relative dirs Cursor's `agent` loads config from. `--trust` (required headless) lets
 * project config run unprompted, and both were verified to execute a PR's hooks:
 * `.cursor/hooks.json`, and Claude Code's `.claude/settings.json` hooks, which Cursor also honors
 * (docs/adr/0027).
 */
const REPO_CONFIG_DIRS = [".cursor", ".claude"];

type CursorId = Extract<AgentId, "cursor-anthropic" | "cursor-grok">;

/**
 * Cursor's headless `agent -p`, shared by the Anthropic and Grok entries. They differ only in
 * `--model` (docs/adr/0027). It has no native structured output, so the schema is appended to
 * every prompt and the JSON is parsed out of the reply text; `invokeAgent` validates it as for any
 * other backend. Its `--output-format json` envelope's camelCase `usage` isn't in Cursor's
 * published docs but is present in practice (docs/adr/0027).
 *
 * `--mode ask` is the CLI's read-only mode: `-p` alone grants write and shell tools, which a
 * prompt-injected PR could use (see docs/adr/0002 for why tulip grants no command execution).
 * `--trust` skips the workspace-trust prompt that otherwise aborts a headless run in the fresh
 * checkout dir. `--force`/`--yolo`/`--approve-mcps` must never be added.
 */
function createCursorBackend(id: CursorId): AgentBackend {
  return {
    id,
    installHint: "install the Cursor CLI (https://cursor.com/cli) and run `agent login`",
    repoConfigDirs: REPO_CONFIG_DIRS,
    planSpawn,
    parseReply: (stdout) => parseReply(stdout, id),
  };
}

export const cursorAnthropicBackend = createCursorBackend("cursor-anthropic");
export const cursorGrokBackend = createCursorBackend("cursor-grok");

async function planSpawn(call: AgentCallArgs): Promise<AgentSpawnPlan> {
  const args = ["-p", "--output-format", "json", "--mode", "ask", "--trust"];
  // Passed on resumes too: unlike `claude --resume`, nothing guarantees the session's model is
  // kept, and each session's model is known (see `Agent.sessionTiers`).
  if (call.model) {
    args.push("--model", call.model);
  }
  if (call.resumeSessionId) {
    args.push("--resume", call.resumeSessionId);
  }
  const prompt = `${call.prompt}\n\n${renderPrompt("structured-output", { schema: JSON.stringify(call.schema) })}`;
  return { args, prompt, files: [] };
}

function parseReply(stdout: string, id: AgentId): AgentReply {
  const envelope = parseEnvelope(stdout, id);
  return replyFrom(envelope, extractJson(envelope.text), {
    input: "inputTokens",
    output: "outputTokens",
    cacheWrite: "cacheWriteTokens",
    cacheRead: "cacheReadTokens",
  });
}
