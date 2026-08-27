import { claudeConcurrencyLimiter } from "./concurrency.js";
import { ClaudeOutputError } from "./errors.js";
import { type ClaudeProcessRunner, runClaudeProcess } from "./exec.js";
import { type JsonSchema, validateAgainstSchema } from "./schema.js";

/** Model alias accepted by `claude --model`. */
export type ClaudeModel = "sonnet" | "haiku" | "opus";

/**
 * Raw envelope printed by `claude -p ... --output-format json`. `result` and `session_id` are
 * documented/stable; `structured_output` appears when `--json-schema` was given. The CLI
 * doesn't publish a formal schema for this envelope, so other fields are passed through as-is.
 */
export interface ClaudeEnvelope {
  result: string;
  session_id: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  usage?: unknown;
  [key: string]: unknown;
}

/** One `claude -p` invocation: either a fresh run (`model` set) or a resume (`resumeSessionId` set). */
export interface ClaudeInvocation {
  model?: ClaudeModel;
  resumeSessionId?: string;
  schema: JsonSchema;
  prompt: string;
}

export interface ClaudeRunResult<T> {
  result: T;
  sessionId: string;
  envelope: ClaudeEnvelope;
}

export interface RunnerDeps {
  /** Defaults to spawning the real `claude` binary on PATH. */
  runClaudeProcess?: ClaudeProcessRunner;
}

const RETRY_PREFIX = "Your previous reply did not parse as JSON matching the required schema";

/**
 * Runs one `claude -p` invocation (fresh or resumed) with structured output, and validates the
 * result against `invocation.schema`. If the model's output is missing, unparseable, or doesn't
 * validate, resumes the session once with a corrective prompt and validates again; throws
 * {@link ClaudeOutputError} if it still doesn't validate.
 */
export async function invokeClaude<T = unknown>(
  invocation: ClaudeInvocation,
  deps: RunnerDeps = {},
): Promise<ClaudeRunResult<T>> {
  const runProcess = deps.runClaudeProcess ?? runClaudeProcess;

  const first = await execute(invocation, runProcess);
  const firstAttempt = extractStructuredOutput<T>(first, invocation.schema);
  if (firstAttempt.ok) {
    return { result: firstAttempt.value, sessionId: first.session_id, envelope: first };
  }

  const retry: ClaudeInvocation = {
    resumeSessionId: first.session_id,
    schema: invocation.schema,
    prompt: `${RETRY_PREFIX}: ${firstAttempt.error}. Reply again with ONLY valid JSON matching the schema.`,
  };
  const second = await execute(retry, runProcess);
  const secondAttempt = extractStructuredOutput<T>(second, invocation.schema);
  if (secondAttempt.ok) {
    return { result: secondAttempt.value, sessionId: second.session_id, envelope: second };
  }

  throw new ClaudeOutputError(
    `claude's structured output was still invalid after a retry: ${secondAttempt.error}`,
  );
}

/**
 * Spawns one `claude` process under the shared concurrency cap (see ./concurrency.ts). The
 * prompt itself is sent over stdin (see ./exec.ts's `ClaudeProcessRunner` doc comment) — argv
 * carries only fixed flags, no variable-length content.
 */
async function execute(
  invocation: ClaudeInvocation,
  runProcess: ClaudeProcessRunner,
): Promise<ClaudeEnvelope> {
  const { stdout } = await claudeConcurrencyLimiter.run(() =>
    runProcess(buildArgs(invocation), invocation.prompt),
  );
  return parseEnvelope(stdout);
}

function buildArgs(invocation: ClaudeInvocation): string[] {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(invocation.schema),
  ];
  if (invocation.model) {
    args.push("--model", invocation.model);
  }
  if (invocation.resumeSessionId) {
    args.push("--resume", invocation.resumeSessionId);
  }
  return args;
}

function parseEnvelope(stdout: string): ClaudeEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new ClaudeOutputError(`claude produced unparseable output: ${truncate(stdout)}`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("session_id" in parsed) ||
    !("result" in parsed)
  ) {
    throw new ClaudeOutputError(
      `claude's output JSON is missing "result"/"session_id": ${truncate(stdout)}`,
    );
  }
  return parsed as ClaudeEnvelope;
}

type ExtractResult<T> = { ok: true; value: T } | { ok: false; error: string };

function extractStructuredOutput<T>(
  envelope: ClaudeEnvelope,
  schema: JsonSchema,
): ExtractResult<T> {
  if (envelope.structured_output === undefined) {
    return {
      ok: false,
      error: `no structured_output in claude's response (result: ${truncate(envelope.result)})`,
    };
  }
  const errors = validateAgainstSchema(envelope.structured_output, schema);
  if (errors.length > 0) {
    return { ok: false, error: errors.join("; ") };
  }
  return { ok: true, value: envelope.structured_output as T };
}

function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
