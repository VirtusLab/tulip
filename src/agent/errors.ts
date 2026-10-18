/** Thrown when the agent's CLI binary (e.g. `claude`, `agent`) can't be found on PATH. */
export class AgentBinaryMissingError extends Error {
  constructor(bin: string, installHint: string, cause?: unknown) {
    super(`\`${bin}\` binary not found on PATH — ${installHint} and ensure \`${bin}\` is on PATH.`);
    this.name = "AgentBinaryMissingError";
    this.cause = cause;
  }
}

/** Thrown when the agent CLI runs but exits with a non-zero status. `detail` is what the CLI
 * said about the failure (see ./exec.ts), empty if nothing. */
export class AgentProcessError extends Error {
  readonly exitCode: number | null;
  readonly detail: string;

  constructor(bin: string, exitCode: number | null, detail: string) {
    super(`\`${bin}\` exited with code ${exitCode}${detail.trim() ? `: ${detail.trim()}` : ""}`);
    this.name = "AgentProcessError";
    this.exitCode = exitCode;
    this.detail = detail;
  }
}

/**
 * Thrown when the agent's stdout can't be parsed as its expected JSON envelope, or its
 * structured output doesn't validate against the requested schema — even after the one
 * automatic retry (see `invokeAgent` in ./runner.ts).
 */
export class AgentOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentOutputError";
  }
}

/** Thrown when an agent invocation doesn't exit within its timeout (see ./exec.ts); the
 * process is killed before this is thrown. */
export class AgentTimeoutError extends Error {
  constructor(bin: string, timeoutMs: number) {
    super(`\`${bin}\` timed out after ${timeoutMs}ms without exiting`);
    this.name = "AgentTimeoutError";
  }
}

/** Shortens agent output quoted in an error message. */
export function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
