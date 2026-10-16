import { config } from "../../config.js";
import type { AgentBackend, AgentCallArgs, AgentReply } from "../backend.js";
import { parseEnvelope, replyFrom } from "../util.js";

/**
 * Claude Code's headless `claude -p`, with native structured output via `--json-schema`. Its
 * `--output-format json` envelope carries `structured_output` when a schema was given, plus
 * Anthropic's usage object: `cache_creation_input_tokens` is input written into the prompt
 * cache, `cache_read_input_tokens` input served from it.
 */
export const claudeBackend: AgentBackend = {
  id: "claude",
  label: "Claude Code",
  bin: config.agents.claude.bin,
  installHint: "install Claude Code",
  modelFor: (tier) => config.agents.claude.models[tier],
  buildArgs,
  preparePrompt: (prompt) => prompt,
  parseReply,
};

function buildArgs(call: AgentCallArgs): string[] {
  const args = ["-p", "--output-format", "json", "--json-schema", JSON.stringify(call.schema)];
  // Omitted entirely when empty (the default — see src/config.ts's `agents.claude.allowedTools`
  // doc comment for why no Bash grant is safe to add): an empty `--allowedTools` flag isn't the
  // same as not passing it, so this can't just always push the flag.
  if (config.agents.claude.allowedTools.length > 0) {
    args.push("--allowedTools", ...config.agents.claude.allowedTools);
  }
  // A resume continues with its session's model, so `--model` is only passed for a fresh call.
  if (call.resumeSessionId) {
    args.push("--resume", call.resumeSessionId);
  } else if (call.model) {
    args.push("--model", call.model);
  }
  return args;
}

function parseReply(stdout: string): AgentReply {
  const envelope = parseEnvelope(stdout, "claude");
  return replyFrom(envelope, envelope.fields.structured_output, {
    input: "input_tokens",
    output: "output_tokens",
    cacheWrite: "cache_creation_input_tokens",
    cacheRead: "cache_read_input_tokens",
  });
}
