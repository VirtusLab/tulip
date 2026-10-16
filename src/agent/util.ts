import type { AgentReply } from "./backend.js";
import { AgentOutputError } from "./errors.js";
import { isPlainObject } from "./schema.js";
import type { ModelTokens } from "./usage.js";

export function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** The two fields every agent CLI's `--output-format json` envelope shares, type-checked, plus
 * the rest of the envelope for the backend to read its own fields from. */
export interface Envelope {
  sessionId: string;
  text: string;
  fields: Record<string, unknown>;
}

/** Parses one call's stdout as a JSON envelope with string `result` and `session_id`; throws
 * {@link AgentOutputError}, labelled with `label` (e.g. "claude"), if it isn't one. */
export function parseEnvelope(stdout: string, label: string): Envelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new AgentOutputError(`${label} produced unparseable output: ${truncate(stdout)}`);
  }
  if (
    !isPlainObject(parsed) ||
    typeof parsed.result !== "string" ||
    typeof parsed.session_id !== "string"
  ) {
    throw new AgentOutputError(
      `${label}'s output JSON is missing string "result"/"session_id": ${truncate(stdout)}`,
    );
  }
  return { sessionId: parsed.session_id, text: parsed.result, fields: parsed };
}

/** Which usage-object field holds each of the four counts, e.g. `input: "input_tokens"`. */
export type UsageFieldNames = Record<keyof ModelTokens, string>;

/**
 * An {@link AgentReply} from a parsed envelope. `num_turns`/`duration_ms` are read when numeric;
 * the usage object (`fields.usage`) via `usageFields`, a missing or non-numeric count reading as
 * 0 so a renamed field degrades to a 0 rather than a crash — while a missing object means "not
 * reported".
 */
export function replyFrom(
  envelope: Envelope,
  structured: unknown,
  usageFields: UsageFieldNames,
): AgentReply {
  const reply: AgentReply = { sessionId: envelope.sessionId, text: envelope.text, structured };
  const { usage, num_turns: numTurns, duration_ms: durationMs } = envelope.fields;
  if (isPlainObject(usage)) {
    reply.usage = {
      input: finiteNumber(usage[usageFields.input]),
      output: finiteNumber(usage[usageFields.output]),
      cacheWrite: finiteNumber(usage[usageFields.cacheWrite]),
      cacheRead: finiteNumber(usage[usageFields.cacheRead]),
    };
  }
  if (typeof numTurns === "number") reply.numTurns = numTurns;
  if (typeof durationMs === "number") reply.durationMs = durationMs;
  return reply;
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
