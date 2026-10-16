import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { formatDuration } from "../logging/duration.js";
import type { Logger } from "../logging/logger.js";
import {
  type Agent,
  type AgentReply,
  type AgentSpawnPlan,
  createAgent,
  type ModelTier,
} from "./backend.js";
import { agentConcurrencyLimiter } from "./concurrency.js";
import { AgentOutputError } from "./errors.js";
import type { AgentProcessRunner } from "./exec.js";
import { type JsonSchema, validateAgainstSchema } from "./schema.js";
import type { UsageCall, UsageLedger } from "./usage.js";
import { truncate } from "./util.js";

/** One agent invocation: either a fresh run (`model` set) or a resume (`resumeSessionId` set). */
export interface AgentInvocation {
  model?: ModelTier;
  resumeSessionId?: string;
  schema: JsonSchema;
  prompt: string;
}

export interface AgentRunResult<T> {
  result: T;
  /** Pass this to `resumeSession` (./session.ts) to continue the conversation. */
  sessionId: string;
}

export interface RunnerDeps {
  /** Which agent CLI to drive, and its per-run session state. The pipeline always sets it to the
   * user's chosen agent (see src/pipeline/run.ts); only phase unit tests leave it out. */
  agent?: Agent;
  /** Overrides the agent's own process runner (which spawns its real binary on PATH). */
  runAgentProcess?: AgentProcessRunner;
  /** Working directory for every spawned agent process — RULING: the pipeline always sets
   * this to the PR checkout dir (see src/pipeline/run.ts), so a session can read the actual
   * repo files instead of inheriting the caller's cwd. */
  cwd?: string;
  /** Collects per-model token usage across the run for the end-of-run summary (see
   * src/agent/usage.ts). When set, every agent invocation (including retries) is recorded. */
  usage?: UsageLedger;
  /** The pipeline's logger, threaded to every phase so progress lines share one sink. Modules
   * fall back to `createLogger()` when absent; the runner itself only logs at debug level. */
  logger?: Logger;
}

const RETRY_PREFIX = "Your previous reply did not parse as JSON matching the required schema";

/** Only for callers that pass no `deps.agent` — phase unit tests, whose mocked process output is
 * claude-shaped. Not a user-facing default: the pipeline always passes the chosen agent. */
const fallbackAgent = createAgent("claude");

/**
 * Runs one agent invocation (fresh or resumed) with structured output, and validates the result
 * against `invocation.schema`. If the model's output is missing, unparseable, or doesn't
 * validate, resumes the session once with a corrective prompt and validates again; throws
 * {@link AgentOutputError} if it still doesn't validate.
 */
export async function invokeAgent<T = unknown>(
  invocation: AgentInvocation,
  deps: RunnerDeps = {},
): Promise<AgentRunResult<T>> {
  const agent = deps.agent ?? fallbackAgent;

  const first = await execute(invocation, agent, deps);
  const firstAttempt = extractStructuredOutput<T>(first, invocation.schema, agent.backend.id);
  if (firstAttempt.ok) {
    return { result: firstAttempt.value, sessionId: first.sessionId };
  }

  const retry: AgentInvocation = {
    resumeSessionId: first.sessionId,
    schema: invocation.schema,
    prompt: `${RETRY_PREFIX}: ${firstAttempt.error}. Reply again with ONLY valid JSON matching the schema.`,
  };
  const second = await execute(retry, agent, deps);
  const secondAttempt = extractStructuredOutput<T>(second, invocation.schema, agent.backend.id);
  if (secondAttempt.ok) {
    return { result: secondAttempt.value, sessionId: second.sessionId };
  }

  throw new AgentOutputError(
    `${agent.backend.id}'s structured output was still invalid after a retry: ${secondAttempt.error}`,
  );
}

/**
 * Spawns one agent process under the shared concurrency cap (see ./concurrency.ts), then records
 * the session's tier and the call's usage. The prompt itself is sent over stdin (see ./exec.ts's
 * `AgentProcessRunner` doc comment) — argv carries only fixed flags, no variable-length content.
 */
async function execute(
  invocation: AgentInvocation,
  agent: Agent,
  deps: RunnerDeps,
): Promise<AgentReply> {
  const { backend } = agent;
  const tier =
    invocation.model ??
    (invocation.resumeSessionId ? agent.sessionTiers.get(invocation.resumeSessionId) : undefined);
  const call: UsageCall | undefined =
    tier === undefined ? undefined : { tier, model: backend.modelFor(tier) };

  const callArgs = {
    ...(call === undefined ? {} : { model: call.model }),
    ...(invocation.resumeSessionId === undefined
      ? {}
      : { resumeSessionId: invocation.resumeSessionId }),
    schema: invocation.schema,
  };
  const planned = backend.planSpawn?.({ ...callArgs, prompt: invocation.prompt });
  const args = planned?.args ?? backend.buildArgs(callArgs);
  const input = planned?.prompt ?? backend.preparePrompt(invocation.prompt, invocation.schema);
  const runProcess = deps.runAgentProcess ?? agent.runProcess;
  const { stdout } = await withSpawnFiles(planned?.files ?? [], () =>
    agentConcurrencyLimiter.run(() =>
      runProcess(args, input, deps.cwd === undefined ? {} : { cwd: deps.cwd }),
    ),
  );
  const reply = backend.parseReply(stdout);

  if (call !== undefined) {
    agent.sessionTiers.set(reply.sessionId, call.tier);
  }
  deps.usage?.record(call, reply.usage);
  if (deps.logger) {
    // `--verbose` trace. Turn count and duration aren't reported by every CLI, so a missing one
    // prints as `?` rather than being assumed.
    const label = invocation.model === undefined ? "resume" : backend.modelFor(invocation.model);
    const turns = reply.numTurns ?? "?";
    const duration = reply.durationMs === undefined ? "?" : formatDuration(reply.durationMs);
    deps.logger.debug(`${backend.id} ${label}: ${turns} turn(s), ${duration}`);
  }
  return reply;
}

/** Writes `files` (a backend's schema file, say), runs `run`, then removes them — including when
 * `run` throws, so a failed call doesn't leave the file behind. */
async function withSpawnFiles<T>(
  files: NonNullable<AgentSpawnPlan["files"]>,
  run: () => Promise<T>,
): Promise<T> {
  try {
    for (const file of files) {
      await mkdir(dirname(file.path), { recursive: true });
      await writeFile(file.path, file.contents, "utf8");
    }
    return await run();
  } finally {
    await Promise.all(files.map((file) => rm(file.path, { force: true })));
  }
}

type ExtractResult<T> = { ok: true; value: T } | { ok: false; error: string };

function extractStructuredOutput<T>(
  reply: AgentReply,
  schema: JsonSchema,
  agentId: string,
): ExtractResult<T> {
  if (reply.structured === undefined) {
    return {
      ok: false,
      error: `no structured output in ${agentId}'s response (result: ${truncate(reply.text)})`,
    };
  }
  const errors = validateAgainstSchema(reply.structured, schema);
  if (errors.length > 0) {
    return { ok: false, error: errors.join("; ") };
  }
  return { ok: true, value: reply.structured as T };
}
