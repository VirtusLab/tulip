import { findFences } from "../rendering/fences.js";
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

/**
 * The JSON value in a reply's text, or `undefined` if none parses. A reply can lead with prose
 * (e.g. "I'll read the file.{...}"), so besides the whole text this tries each fenced code block
 * (last first), then each `{...}` span from the left — the leftmost one that parses is the
 * outermost object. A balanced span that doesn't parse is skipped whole, so a malformed reply
 * costs one pass, not one per nested brace.
 */
export function extractJson(text: string): unknown {
  const whole = tryParse(text.trim());
  if (whole !== undefined) {
    return whole;
  }
  for (const fence of findFences(text).reverse()) {
    const value = tryParse(fence.content.trim());
    if (value !== undefined) {
      return value;
    }
  }
  let start = text.indexOf("{");
  while (start !== -1) {
    const end = matchingBrace(text, start);
    if (end === -1) {
      start = text.indexOf("{", start + 1);
      continue;
    }
    const value = tryParse(text.slice(start, end + 1));
    if (value !== undefined) {
      return value;
    }
    start = text.indexOf("{", end + 1);
  }
  return undefined;
}

function tryParse(candidate: string): unknown {
  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}

/** Index of the `}` closing the `{` at `start`, skipping braces inside JSON strings; -1 if none. */
function matchingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") {
        i++;
      } else if (ch === '"') {
        inString = false;
      }
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}
