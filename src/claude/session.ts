import { withPreamble } from "./preamble.js";
import { type ClaudeModel, invokeClaude, type RunnerDeps } from "./runner.js";
import type { JsonSchema } from "./schema.js";

export interface RunSessionOptions {
  model: ClaudeModel;
  schema: JsonSchema;
  prompt: string;
}

export interface ResumeSessionOptions {
  /** Session id returned by an earlier {@link runSession} or {@link resumeSession} call. */
  sessionId: string;
  schema: JsonSchema;
  prompt: string;
}

export interface ClaudeSessionResult<T> {
  result: T;
  /** Pass this to {@link resumeSession} to continue the conversation. */
  sessionId: string;
}

/**
 * Starts a fresh `claude` session with the given model and structured-output schema. Every
 * phase (epics 4-6) that begins a new line of reasoning (e.g. generating categories) uses this.
 */
export async function runSession<T = unknown>(
  options: RunSessionOptions,
  deps: RunnerDeps = {},
): Promise<ClaudeSessionResult<T>> {
  const { result, sessionId } = await invokeClaude<T>(
    { model: options.model, schema: options.schema, prompt: withPreamble(options.prompt) },
    deps,
  );
  return { result, sessionId };
}

/**
 * Continues an existing `claude` session with a follow-up prompt and the same
 * structured-output contract. Used e.g. to consult a category-creating session about a
 * proposed new category, or to keep classifying changes across multiple turns.
 */
export async function resumeSession<T = unknown>(
  options: ResumeSessionOptions,
  deps: RunnerDeps = {},
): Promise<ClaudeSessionResult<T>> {
  const { result, sessionId } = await invokeClaude<T>(
    { resumeSessionId: options.sessionId, schema: options.schema, prompt: options.prompt },
    deps,
  );
  return { result, sessionId };
}
