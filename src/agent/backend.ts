import { claudeBackend } from "./backends/claude.js";
import { codexBackend } from "./backends/codex.js";
import { cursorBackend } from "./backends/cursor.js";
import { type AgentProcessRunner, createAgentProcessRunner } from "./exec.js";
import type { JsonSchema } from "./schema.js";
import type { ModelTokens } from "./usage.js";

/** Every agent CLI tulip can drive (docs/adr/0026). There is no default: the user picks one,
 * and the choice is remembered (see src/cli/agent-choice.ts). */
export const AGENT_IDS = ["claude", "cursor", "codex"] as const;

export type AgentId = (typeof AGENT_IDS)[number];

/**
 * Agent-neutral model size each phase asks for (see src/config.ts's `models`); every backend maps
 * it to its own `--model` id via `config.agents.<id>.models`.
 */
export type ModelTier = "fast" | "balanced" | "strong";

/** One agent CLI reply, normalized from that CLI's own JSON envelope. */
export interface AgentReply {
  sessionId: string;
  /** The envelope's `result` text (for Cursor, every assistant message of the turn joined), for
   * error messages. */
  text: string;
  /** The reply's structured output, before schema validation; `undefined` if there was none (or
   * it couldn't be parsed) — {@link invokeAgent}'s retry then asks again. */
  structured: unknown;
  /** Absent when the CLI didn't report token usage for this call. */
  usage?: ModelTokens;
  numTurns?: number;
  durationMs?: number;
}

/** The argv-relevant parts of one invocation, as handed to {@link AgentBackend.buildArgs}. */
export interface AgentCallArgs {
  /** The backend's own model id, resolved from the invocation's tier. Absent only for a resume
   * of a session that was never recorded (see {@link Agent.sessionTiers}). */
  model?: string;
  resumeSessionId?: string;
  schema: JsonSchema;
}

/** One call as the runner spawns it. `files` are written before the process starts and removed
 * after it exits, so a backend can hand the CLI a path instead of putting a large payload in argv. */
export interface AgentSpawnPlan {
  args: string[];
  prompt: string;
  files?: { path: string; contents: string }[];
}

/**
 * Everything specific to one agent CLI: how to call it and how to read its reply. The generic
 * parts — retry on invalid output, schema validation, concurrency, usage, sessions — live in
 * ./runner.ts and ./session.ts and are shared by every backend.
 */
export interface AgentBackend {
  id: AgentId;
  /** Human-readable product name, e.g. for the first-run agent menu. */
  label: string;
  /** Binary spawned on PATH. */
  bin: string;
  /** Completes "`<bin>` binary not found on PATH — <installHint> and ensure ...". */
  installHint: string;
  modelFor(tier: ModelTier): string;
  /** argv for one call; the prompt itself always goes over stdin (see ./exec.ts). */
  buildArgs(call: AgentCallArgs): string[];
  /** The stdin text for one call, e.g. with the schema appended for a CLI without native
   * structured output. Applied to every turn, resumes and retries included. */
  preparePrompt(prompt: string, schema: JsonSchema): string;
  /** When set, the runner uses this instead of {@link buildArgs} and {@link preparePrompt}.
   * Use it when a call needs a file on disk (a schema file) as well as argv and stdin. */
  planSpawn?(call: AgentCallArgs & { prompt: string }): AgentSpawnPlan;
  /** Parses one call's stdout; throws {@link AgentOutputError} if it isn't a valid envelope. */
  parseReply(stdout: string): AgentReply;
  /** Run once on the checkout before any call, to neutralize repo-controlled agent config the
   * CLI would otherwise load (and possibly execute) from its cwd. */
  prepareWorkspace?(dir: string): Promise<void>;
}

/** One run's handle on an agent: its backend, process runner, and per-session model tiers. */
export interface Agent {
  backend: AgentBackend;
  runProcess: AgentProcessRunner;
  /** Each session's tier, recorded when it starts, so a resume (which carries only a session id)
   * can still pass `--model` where the CLI needs it and be attributed in the usage summary. */
  sessionTiers: Map<string, ModelTier>;
}

const BACKENDS: Record<AgentId, AgentBackend> = {
  claude: claudeBackend,
  cursor: cursorBackend,
  codex: codexBackend,
};

export function backendFor(id: AgentId): AgentBackend {
  return BACKENDS[id];
}

/** A fresh {@link Agent} for `id`; create one per run and thread it via `RunnerDeps.agent`. */
export function createAgent(id: AgentId): Agent {
  const backend = backendFor(id);
  return {
    backend,
    runProcess: createAgentProcessRunner(backend.bin, { installHint: backend.installHint }),
    sessionTiers: new Map(),
  };
}

export function isAgentId(value: string): value is AgentId {
  return (AGENT_IDS as readonly string[]).includes(value);
}
