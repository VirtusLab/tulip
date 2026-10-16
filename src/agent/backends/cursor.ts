import { rm } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../../config.js";
import { renderPrompt } from "../../prompts/loader.js";
import type { AgentBackend, AgentCallArgs, AgentReply, AgentSpawnPlan } from "../backend.js";
import { AgentOutputError } from "../errors.js";
import { extractJson, parseEnvelope, replyFrom, truncate } from "../util.js";

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
  planSpawn,
  parseReply,
  prepareWorkspace,
};

function planSpawn(call: AgentCallArgs): AgentSpawnPlan {
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

/** `rm` with `force` unlinks a symlinked dir without following it, so nothing outside the
 * checkout is touched. */
async function prepareWorkspace(dir: string): Promise<void> {
  await Promise.all(
    REPO_CONFIG_DIRS.map((name) => rm(join(dir, name), { recursive: true, force: true })),
  );
}
