/** Thrown when the `claude` binary can't be found on PATH. */
export class ClaudeBinaryMissingError extends Error {
  constructor(cause?: unknown) {
    super(
      "`claude` binary not found on PATH — install Claude Code and ensure `claude` is on PATH.",
    );
    this.name = "ClaudeBinaryMissingError";
    this.cause = cause;
  }
}

/** Thrown when `claude` runs but exits with a non-zero status. */
export class ClaudeProcessError extends Error {
  readonly exitCode: number | null;
  readonly stderr: string;

  constructor(exitCode: number | null, stderr: string) {
    super(`claude exited with code ${exitCode}${stderr.trim() ? `: ${stderr.trim()}` : ""}`);
    this.name = "ClaudeProcessError";
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

/**
 * Thrown when `claude`'s stdout can't be parsed as its expected JSON envelope, or its
 * structured output doesn't validate against the requested schema — even after the one
 * automatic retry (see `invokeClaude` in ./runner.ts).
 */
export class ClaudeOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeOutputError";
  }
}
