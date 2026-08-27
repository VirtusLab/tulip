/**
 * Prepended to every session's first prompt (see `runSession` in ./session.ts), per the spec's
 * "General LLM guidelines" — every phase (epics 4-6) inherits this by going through that API.
 * Not repeated on resumes: the model already has it from the first turn.
 */
export const PREAMBLE =
  "Be short and to the point. Avoid jargon and use simple words. " +
  "Explain facts in simple terms — don't try to sound smart.";

/** Prepends {@link PREAMBLE} to `prompt`, separated by a blank line. */
export function withPreamble(prompt: string): string {
  return `${PREAMBLE}\n\n${prompt}`;
}
