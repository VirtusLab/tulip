import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runCommand } from "../../process/exec.js";
import { AgentBinaryMissingError } from "../errors.js";
import { isPlainObject } from "../schema.js";

/** Helper dirs Codex keeps next to its binary's `bin/` dir: `codex-path` is put on the shell's
 * PATH (e.g. `rg`), `codex-resources` holds a fallback `bwrap`. */
const HELPER_DIRS = ["codex-path", "codex-resources"];

/**
 * Dirs the sandbox must be able to read for Codex to run commands at all: on Linux, Codex
 * re-executes its own binary inside bubblewrap, so without them every command fails with
 * "bwrap: execvp <executable>: No such file or directory".
 */
export function sandboxReadDirs(executable: string): string[] {
  const binDir = dirname(executable);
  const helpers = HELPER_DIRS.map((name) => join(dirname(binDir), name)).filter((dir) =>
    existsSync(dir),
  );
  return [binDir, ...helpers];
}

/**
 * The native binary `bin` runs, as reported by `<bin> doctor --json`. Asking Codex itself sees
 * through launchers and shims (npm's `codex.js`, mise, volta, wrapper scripts), which a PATH
 * lookup can't. Throws {@link AgentBinaryMissingError} (with `installHint`) if `bin` isn't on PATH.
 */
export async function findCodexExecutable(
  bin: string,
  installHint: string,
  run: (bin: string, args: string[]) => Promise<string> = (b, args) =>
    runCommand(b, args, { cwd: tmpdir() }),
): Promise<string> {
  let report: string;
  try {
    report = await run(bin, ["doctor", "--json"]);
  } catch (error) {
    if (isPlainObject(error) && error.code === "ENOENT") {
      throw new AgentBinaryMissingError(bin, installHint, error);
    }
    // `doctor` exits non-zero when a check fails, but still prints its report.
    const stdout = isPlainObject(error) ? error.stdout : undefined;
    if (typeof stdout !== "string" || stdout === "") throw error;
    report = stdout;
  }
  const executable = executableFromDoctorReport(report);
  if (executable === undefined) {
    throw new Error(
      `\`${bin} doctor --json\` didn't report Codex's executable, which its sandbox must be allowed to read`,
    );
  }
  return executable;
}

/** The "current executable" detail of a `codex doctor --json` report, if present. */
export function executableFromDoctorReport(report: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(report);
  } catch {
    return undefined;
  }
  const checks = isPlainObject(parsed) ? parsed.checks : undefined;
  if (!isPlainObject(checks)) return undefined;
  for (const id of ["installation", "runtime.provenance"]) {
    const check = checks[id];
    const details = isPlainObject(check) ? check.details : undefined;
    const executable = isPlainObject(details) ? details["current executable"] : undefined;
    if (typeof executable === "string" && executable !== "") return executable;
  }
  return undefined;
}
