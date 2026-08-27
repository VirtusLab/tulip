import { execFile } from "node:child_process";
import { ClaudeBinaryMissingError, ClaudeProcessError } from "./errors.js";

/** Raw stdout/stderr from one `claude` invocation. */
export interface ClaudeProcessResult {
  stdout: string;
  stderr: string;
}

/**
 * Runs the `claude` binary with the given args and returns its stdout/stderr. Mockable in
 * tests (see `RunnerDeps` in ./runner.ts). Throws {@link ClaudeBinaryMissingError} if the
 * binary isn't on PATH, or {@link ClaudeProcessError} on a non-zero exit.
 */
export type ClaudeProcessRunner = (args: string[]) => Promise<ClaudeProcessResult>;

/** Generous enough for a large structured-output response without truncating. */
const MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/**
 * Builds a {@link ClaudeProcessRunner} that spawns `bin`. Defaults to `"claude"`; tests use
 * this to point at a different (or nonexistent) binary without touching the real `claude`.
 */
export function createClaudeProcessRunner(bin = "claude"): ClaudeProcessRunner {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile(bin, args, { maxBuffer: MAX_BUFFER_BYTES }, (error, stdout, stderr) => {
        if (error === null) {
          resolve({ stdout, stderr });
          return;
        }
        if (error.code === "ENOENT") {
          reject(new ClaudeBinaryMissingError(error));
          return;
        }
        const exitCode = typeof error.code === "number" ? error.code : null;
        reject(new ClaudeProcessError(exitCode, stderr));
      });
    });
}

/** The default runner: spawns the real `claude` binary on PATH. */
export const runClaudeProcess: ClaudeProcessRunner = createClaudeProcessRunner();
