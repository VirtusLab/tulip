import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Generous enough for a full PR diff or `git show` of a large file without truncating. */
const MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/** Generous per-call ceiling for a single `gh`/`git` subcommand — a hung process would
 * otherwise block the pipeline forever. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 2 * 60 * 1000;

/** Runs an external command and returns its stdout. Shared by the `gh` and `git` wrappers. Kills
 * the process and throws a clear error if it doesn't exit within `timeoutMs` (default
 * {@link DEFAULT_COMMAND_TIMEOUT_MS}). */
export async function runCommand(
  bin: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  try {
    const { stdout } = await execFileAsync(bin, args, {
      cwd: options.cwd,
      maxBuffer: MAX_BUFFER_BYTES,
      timeout: timeoutMs,
    });
    return stdout;
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new Error(`${bin} ${args.join(" ")} timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
}

/** `execFile`'s own timeout kills the child and sets `killed: true` on the rejected error —
 * distinguishes that from an ordinary non-zero-exit failure. */
function isTimeoutError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "killed" in error &&
    (error as { killed?: boolean }).killed === true
  );
}
