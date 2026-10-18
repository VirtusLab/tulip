import { AgentOutputError, truncate } from "../errors.js";
import { isPlainObject } from "../schema.js";
import type { AgentReply } from "../types.js";
import { readUsage, type UsageFieldNames } from "./usage-fields.js";

/** The two fields every single-envelope CLI's `--output-format json` output shares (Claude,
 * Cursor), type-checked, plus the rest of the envelope for the backend to read its own fields
 * from. */
interface Envelope {
  sessionId: string;
  text: string;
  fields: Record<string, unknown>;
}

/** Parses one call's stdout as a JSON envelope with string `result` and `session_id`; throws
 * {@link AgentOutputError}, labelled with `label` (e.g. "claude"), if it isn't one or it reports
 * `is_error`. */
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
  if (parsed.is_error === true) {
    throw new AgentOutputError(`${label} reported an error: ${truncate(parsed.result)}`);
  }
  return { sessionId: parsed.session_id, text: parsed.result, fields: parsed };
}

/** An {@link AgentReply} from a parsed envelope: `num_turns`/`duration_ms` when numeric, and the
 * `usage` object read via `usageFields` (see {@link readUsage}). */
export function replyFrom(
  envelope: Envelope,
  structured: unknown,
  usageFields: UsageFieldNames,
): AgentReply {
  const reply: AgentReply = { sessionId: envelope.sessionId, text: envelope.text, structured };
  const { usage, num_turns: numTurns, duration_ms: durationMs } = envelope.fields;
  const tokens = readUsage(usage, usageFields);
  if (tokens !== undefined) reply.usage = tokens;
  if (typeof numTurns === "number") reply.numTurns = numTurns;
  if (typeof durationMs === "number") reply.durationMs = durationMs;
  return reply;
}
