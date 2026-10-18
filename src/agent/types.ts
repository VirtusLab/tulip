import type { AgentProcessRunner } from "./exec.js";
import type { JsonSchema } from "./schema.js";

/** Every agent CLI tulip can drive (docs/adr/0027); src/cli/agent-choice.ts picks one per run.
 * Each has an entry in src/config.ts's `agents` and a backend in src/agent-registry. */
export const AGENT_IDS = ["claude", "cursor-anthropic", "cursor-grok", "codex"] as const;

export type AgentId = (typeof AGENT_IDS)[number];

export function isAgentId(value: string): value is AgentId {
  return (AGENT_IDS as readonly string[]).includes(value);
}

/**
 * Agent-neutral model size each phase asks for (see src/config.ts's `models`); every agent maps
 * it to its own `--model` id via `config.agents.<id>.models`.
 */
export type ModelTier = "fast" | "balanced" | "strong";

/**
 * One model's token counts. `cacheWrite`/`cacheRead` are the two prompt-cache counts — both
 * input-side (there is no cached output): `cacheWrite` is input written into the cache,
 * `cacheRead` input served from it. `input`/`output` are the ordinary (uncached) input and output
 * token counts. Each backend maps its CLI's own usage fields onto these (see src/agent/backends).
 */
export interface ModelTokens {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

/** One agent CLI reply, normalized from that CLI's own JSON output. */
export interface AgentReply {
  sessionId: string;
  /** The reply's final text (for Cursor, every assistant message of the turn joined), for error
   * messages. */
  text: string;
  /** The reply's structured output, before schema validation; `undefined` if there was none (or
   * it couldn't be parsed) — `invokeAgent`'s retry then asks again. */
  structured: unknown;
  /** Absent when the CLI didn't report token usage for this call. */
  usage?: ModelTokens;
  numTurns?: number;
  durationMs?: number;
}

/** One invocation, as handed to {@link AgentBackend.planSpawn}. */
export interface AgentCallArgs {
  /** The prompt; it goes on stdin (see ./exec.ts). */
  prompt: string;
  schema: JsonSchema;
  /** The agent's own model id, resolved from the invocation's tier. Absent only for a resume of
   * a session that was never recorded (see {@link Agent.sessionTiers}). */
  model?: string;
  resumeSessionId?: string;
}

/** One call as the runner spawns it. `files` are written before the process starts and removed
 * after it exits, so a backend can hand the CLI a path where it needs one.
 * Each file's directory must already exist. */
export interface AgentSpawnPlan {
  args: string[];
  prompt: string;
  files: { path: string; contents: string }[];
}

/**
 * Everything specific to one agent CLI: how to call it and how to read its reply. The generic
 * parts — retry on invalid output, schema validation, concurrency, usage, sessions — live in
 * ./runner.ts and ./session.ts and are shared by every backend. The binary and model ids come
 * from `config.agents[id]` (see ./agent.ts).
 */
export interface AgentBackend {
  id: AgentId;
  /** Completes "`<bin>` binary not found on PATH — <installHint> and ensure ...". */
  installHint: string;
  /** Checkout-relative dirs of repo-controlled config the CLI would load (and possibly execute)
   * from its cwd; removed from the checkout before any call (see ./workspace.ts). */
  repoConfigDirs: readonly string[];
  /** argv, stdin, and any files for one call. The prompt itself always goes over stdin
   * (see ./exec.ts). `files` is empty unless the CLI needs a path, such as a schema file. */
  planSpawn(call: AgentCallArgs): Promise<AgentSpawnPlan>;
  /** Parses one call's stdout; throws `AgentOutputError` if it isn't a valid reply. `schema` is
   * the call's own, as given to {@link planSpawn}. */
  parseReply(stdout: string, schema: JsonSchema): AgentReply;
  /** The CLI's own error message in a failed call's stdout, for a CLI that reports failures
   * there; preferred over stderr. */
  describeFailure?(stdout: string): string | undefined;
  /** Set when a reply's usage is its session's running total rather than that call's own; the
   * runner then records the difference from the session's previous total. */
  usageIsSessionTotal?: boolean;
}

/** One run's handle on an agent: its backend, process runner, and per-session state. Built by
 * `createAgent` (./agent.ts). */
export interface Agent {
  backend: AgentBackend;
  /** Maps a tier to this agent's model id. */
  modelFor(tier: ModelTier): string;
  runProcess: AgentProcessRunner;
  /** Each session's tier, recorded when it starts, so a resume (which carries only a session id)
   * can still pass `--model` where the CLI needs it and be attributed in the usage summary. */
  sessionTiers: Map<string, ModelTier>;
  /** Each session's latest running usage total, for a backend with
   * {@link AgentBackend.usageIsSessionTotal}. */
  sessionUsage: Map<string, ModelTokens>;
}
