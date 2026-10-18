import { rm, writeFile } from "node:fs/promises";
import { formatDuration } from "../logging/duration.js";
import type { Logger } from "../logging/logger.js";
import { createAgent } from "./agent.js";
import { claudeBackend } from "./backends/claude.js";
import { agentConcurrencyLimiter } from "./concurrency.js";
import { AgentOutputError, truncate } from "./errors.js";
import type { AgentProcessRunner } from "./exec.js";
import { type JsonSchema, validateAgainstSchema } from "./schema.js";
import type { Agent, AgentReply, AgentSpawnPlan, ModelTier, ModelTokens } from "./types.js";
import type { UsageCall, UsageLedger } from "./usage.js";

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
  // Only callers that pass no agent (phase unit tests) get here; a fresh one per call keeps their
  // session state apart. The pipeline always passes the run's agent.
  const agent = deps.agent ?? createAgent(claudeBackend);

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
 * the session's tier and the call's usage. The prompt goes on stdin (see ./exec.ts).
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
    tier === undefined ? undefined : { tier, model: agent.modelFor(tier) };

  const planned = await backend.planSpawn({
    prompt: invocation.prompt,
    schema: invocation.schema,
    ...(call === undefined ? {} : { model: call.model }),
    ...(invocation.resumeSessionId === undefined
      ? {}
      : { resumeSessionId: invocation.resumeSessionId }),
  });
  const runProcess = deps.runAgentProcess ?? agent.runProcess;
  const { stdout } = await withSpawnFiles(planned.files, () =>
    agentConcurrencyLimiter.run(() =>
      runProcess(planned.args, planned.prompt, deps.cwd === undefined ? {} : { cwd: deps.cwd }),
    ),
  );
  const reply = backend.parseReply(stdout, invocation.schema);

  if (call !== undefined) {
    agent.sessionTiers.set(reply.sessionId, call.tier);
  }
  deps.usage?.record(call, callUsage(agent, invocation, reply));
  if (deps.logger) {
    // `--verbose` trace. Turn count and duration aren't reported by every CLI, so a missing one
    // prints as `?` rather than being assumed.
    const label = invocation.model === undefined || call === undefined ? "resume" : call.model;
    const turns = reply.numTurns ?? "?";
    const duration = reply.durationMs === undefined ? "?" : formatDuration(reply.durationMs);
    deps.logger.debug(`${backend.id} ${label}: ${turns} turn(s), ${duration}`);
  }
  return reply;
}

/** The call's own tokens. For a backend reporting session totals, that's the difference from the
 * total last seen for the resumed session. */
function callUsage(
  agent: Agent,
  invocation: AgentInvocation,
  reply: AgentReply,
): ModelTokens | undefined {
  const { usage } = reply;
  if (!agent.backend.usageIsSessionTotal || usage === undefined) {
    return usage;
  }
  const previous =
    invocation.resumeSessionId === undefined
      ? undefined
      : agent.sessionUsage.get(invocation.resumeSessionId);
  agent.sessionUsage.set(reply.sessionId, usage);
  if (previous === undefined) {
    return usage;
  }
  return {
    input: Math.max(0, usage.input - previous.input),
    output: Math.max(0, usage.output - previous.output),
    cacheWrite: Math.max(0, usage.cacheWrite - previous.cacheWrite),
    cacheRead: Math.max(0, usage.cacheRead - previous.cacheRead),
  };
}

/** Writes `files` (a backend's schema file, say), runs `run`, then removes them — including when
 * `run` throws, so a failed call doesn't leave the file behind. */
async function withSpawnFiles<T>(
  files: AgentSpawnPlan["files"],
  run: () => Promise<T>,
): Promise<T> {
  try {
    for (const file of files) {
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
