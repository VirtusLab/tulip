import { createAgent } from "../agent/agent.js";
import { claudeBackend } from "../agent/backends/claude.js";
import { codexBackend } from "../agent/backends/codex.js";
import { cursorAnthropicBackend, cursorGrokBackend } from "../agent/backends/cursor.js";
import type { Agent, AgentBackend, AgentId } from "../agent/types.js";

const BACKENDS: Record<AgentId, AgentBackend> = {
  claude: claudeBackend,
  "cursor-anthropic": cursorAnthropicBackend,
  "cursor-grok": cursorGrokBackend,
  codex: codexBackend,
};

/** A fresh {@link Agent} for `id`; create one per run and thread it via `RunnerDeps.agent`. */
export function createAgentFor(id: AgentId): Agent {
  return createAgent(BACKENDS[id]);
}
