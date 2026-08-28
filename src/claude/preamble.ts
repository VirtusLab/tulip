import { renderPrompt } from "../prompts/loader.js";

/**
 * Prepended to every session's first prompt (see `runSession` in ./session.ts), per the spec's
 * "General LLM guidelines" — every phase (epics 4-6) inherits this by going through that API.
 * Not repeated on resumes: the model already has it from the first turn. Text lives in
 * src/prompts/preamble.md (docs/adr/0006).
 */
export const PREAMBLE = renderPrompt("preamble", {});

/** Prepends {@link PREAMBLE} to `prompt`, separated by a blank line. */
export function withPreamble(prompt: string): string {
  return `${PREAMBLE}\n\n${prompt}`;
}
