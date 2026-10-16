import { spawn } from "node:child_process";
import { config } from "../config.js";
import { AgentBinaryMissingError, AgentProcessError, AgentTimeoutError } from "./errors.js";

/** Raw stdout/stderr from one agent CLI invocation. */
export interface AgentProcessResult {
  stdout: string;
  stderr: string;
}

/** Per-invocation options for an {@link AgentProcessRunner} call. */
export interface AgentProcessOptions {
  /** Working directory for the spawned process — RULING: always the PR checkout dir, so the
   * agent reads the actual repo files instead of inheriting the caller's cwd. */
  cwd?: string;
}

/**
 * Runs an agent CLI binary with the given args, writing `input` to its stdin (then closing it).
 * Mockable in tests (see `RunnerDeps` in ./runner.ts). Throws {@link AgentBinaryMissingError} if
 * the binary isn't on PATH, or {@link AgentProcessError} on a non-zero exit.
 *
 * Prompt content is delivered via stdin rather than as an argv element: prompts embed full PR
 * diffs and can be arbitrarily large, while a single argv string is capped by the OS (e.g. Linux's
 * ~128KB `MAX_ARG_STRLEN`). Both `claude -p` (documented, capped at 10MB) and Cursor's `agent -p`
 * (verified, docs/adr/0026) read the prompt from piped stdin, so callers never need to pass the
 * prompt as an argv token.
 */
export type AgentProcessRunner = (
  args: string[],
  input: string,
  options?: AgentProcessOptions,
) => Promise<AgentProcessResult>;

export interface AgentProcessRunnerOptions {
  /** Shown in {@link AgentBinaryMissingError} when `bin` isn't on PATH, e.g. "install Claude
   * Code". */
  installHint?: string;
  /** Defaults to {@link config}.timeouts.agentProcessMs. */
  timeoutMs?: number;
}

/**
 * Builds an {@link AgentProcessRunner} that spawns `bin` (one backend's CLI). Kills the child
 * and rejects with {@link AgentTimeoutError} if it doesn't exit within the timeout — a hung
 * agent process would otherwise block the pipeline forever.
 */
export function createAgentProcessRunner(
  bin: string,
  options: AgentProcessRunnerOptions = {},
): AgentProcessRunner {
  const installHint = options.installHint ?? `install \`${bin}\``;
  const timeoutMs = options.timeoutMs ?? config.timeouts.agentProcessMs;
  return (args, input, runOptions) =>
    new Promise((resolve, reject) => {
      const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"], cwd: runOptions?.cwd });
      let stdout = "";
      let stderr = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(new AgentTimeoutError(bin, timeoutMs));
      }, timeoutMs);

      // Decoded as a stream so a multi-byte character split across chunks isn't mangled.
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      // If the binary doesn't exist (or spawning otherwise fails), the child never starts —
      // classify that here rather than in "close". Also swallow stdin "error" (e.g. EPIPE if
      // the process exits/crashes before we finish writing): the same failure is already
      // reported via this "error" event or a non-zero exit in "close".
      child.on("error", (error: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error.code === "ENOENT") {
          reject(new AgentBinaryMissingError(bin, installHint, error));
        } else {
          reject(new AgentProcessError(bin, null, error.message));
        }
      });
      child.stdin.on("error", () => {});

      child.stdin.write(input);
      child.stdin.end();

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new AgentProcessError(bin, code, stderr));
        }
      });
    });
}
