import { spawn } from "node:child_process";
import { ClaudeBinaryMissingError, ClaudeProcessError } from "./errors.js";

/** Raw stdout/stderr from one `claude` invocation. */
export interface ClaudeProcessResult {
  stdout: string;
  stderr: string;
}

/**
 * Runs the `claude` binary with the given args, writing `input` to its stdin (then closing it).
 * Mockable in tests (see `RunnerDeps` in ./runner.ts). Throws {@link ClaudeBinaryMissingError} if
 * the binary isn't on PATH, or {@link ClaudeProcessError} on a non-zero exit.
 *
 * Prompt content is delivered via stdin rather than as an argv element: prompts embed full PR
 * diffs and can be arbitrarily large, while a single argv string is capped by the OS (e.g. Linux's
 * ~128KB `MAX_ARG_STRLEN`); `claude`'s documented headless pattern for bulk input is piping it
 * through stdin (capped at 10MB), so callers never need to pass the prompt as an argv token.
 */
export type ClaudeProcessRunner = (args: string[], input: string) => Promise<ClaudeProcessResult>;

/**
 * Builds a {@link ClaudeProcessRunner} that spawns `bin`. Defaults to `"claude"`; tests use
 * this to point at a different (or nonexistent) binary without touching the real `claude`.
 */
export function createClaudeProcessRunner(bin = "claude"): ClaudeProcessRunner {
  return (args, input) =>
    new Promise((resolve, reject) => {
      const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let settled = false;

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk;
      });

      // If the binary doesn't exist (or spawning otherwise fails), the child never starts —
      // classify that here rather than in "close". Also swallow stdin "error" (e.g. EPIPE if
      // the process exits/crashes before we finish writing): the same failure is already
      // reported via this "error" event or a non-zero exit in "close".
      child.on("error", (error: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        if (error.code === "ENOENT") {
          reject(new ClaudeBinaryMissingError(error));
        } else {
          reject(new ClaudeProcessError(null, error.message));
        }
      });
      child.stdin.on("error", () => {});

      child.stdin.write(input);
      child.stdin.end();

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new ClaudeProcessError(code, stderr));
        }
      });
    });
}

/** The default runner: spawns the real `claude` binary on PATH. */
export const runClaudeProcess: ClaudeProcessRunner = createClaudeProcessRunner();
