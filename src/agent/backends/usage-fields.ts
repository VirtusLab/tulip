import { isPlainObject } from "../schema.js";
import type { ModelTokens } from "../types.js";

/** Which usage-object field holds each of the four counts, e.g. `input: "input_tokens"`. */
export type UsageFieldNames = Record<keyof ModelTokens, string>;

/**
 * The counts in a CLI's usage object, read via `fields`. A missing or non-numeric count reads as
 * 0, so a renamed field degrades to a 0 rather than a crash; a missing object (not reported)
 * gives `undefined`.
 */
export function readUsage(usage: unknown, fields: UsageFieldNames): ModelTokens | undefined {
  if (!isPlainObject(usage)) {
    return undefined;
  }
  return {
    input: finiteNumber(usage[fields.input]),
    output: finiteNumber(usage[fields.output]),
    cacheWrite: finiteNumber(usage[fields.cacheWrite]),
    cacheRead: finiteNumber(usage[fields.cacheRead]),
  };
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
