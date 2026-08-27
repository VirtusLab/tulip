import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Generous enough for a full PR diff or `git show` of a large file without truncating. */
const MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/** Runs an external command and returns its stdout. Shared by the `gh` and `git` wrappers. */
export async function runCommand(
  bin: string,
  args: string[],
  options: { cwd?: string } = {},
): Promise<string> {
  const { stdout } = await execFileAsync(bin, args, {
    cwd: options.cwd,
    maxBuffer: MAX_BUFFER_BYTES,
  });
  return stdout;
}
