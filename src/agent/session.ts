import { withPreamble } from "./preamble.js";
import { type AgentRunResult, invokeAgent, type RunnerDeps } from "./runner.js";
import type { JsonSchema } from "./schema.js";
import type { ModelTier } from "./types.js";

export interface RunSessionOptions {
  model: ModelTier;
  schema: JsonSchema;
  prompt: string;
}

export interface ResumeSessionOptions {
  /** Session id returned by an earlier {@link runSession} or {@link resumeSession} call. */
  sessionId: string;
  schema: JsonSchema;
  prompt: string;
}

/**
 * Starts a fresh agent session with the given model and structured-output schema. Every
 * phase (epics 4-6) that begins a new line of reasoning (e.g. generating categories) uses this.
 */
export function runSession<T = unknown>(
  options: RunSessionOptions,
  deps: RunnerDeps = {},
): Promise<AgentRunResult<T>> {
  return invokeAgent<T>(
    { model: options.model, schema: options.schema, prompt: withPreamble(options.prompt) },
    deps,
  );
}

/**
 * Continues an existing agent session with a follow-up prompt and the same
 * structured-output contract. Used e.g. to consult a category-creating session about a
 * proposed new category, or to keep classifying changes across multiple turns.
 */
export function resumeSession<T = unknown>(
  options: ResumeSessionOptions,
  deps: RunnerDeps = {},
): Promise<AgentRunResult<T>> {
  return invokeAgent<T>(
    { resumeSessionId: options.sessionId, schema: options.schema, prompt: options.prompt },
    deps,
  );
}
