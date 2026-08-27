import { describe, expect, it } from "vitest";
import { ClaudeBinaryMissingError, ClaudeProcessError } from "./errors.js";
import { createClaudeProcessRunner } from "./exec.js";

// These spawn real (non-`claude`) processes to exercise the actual error-classification paths —
// no live `claude`/LLM calls are made anywhere in this file.

describe("createClaudeProcessRunner", () => {
  it("throws ClaudeBinaryMissingError when the binary isn't on PATH", async () => {
    const run = createClaudeProcessRunner("tulip-claude-binary-that-does-not-exist");

    await expect(run(["-p", "hi"])).rejects.toThrow(ClaudeBinaryMissingError);
  });

  it("throws ClaudeProcessError with the exit code and stderr on a non-zero exit", async () => {
    const run = createClaudeProcessRunner(process.execPath);
    const result = run(["-e", "process.stderr.write('boom'); process.exit(7)"]);

    await expect(result).rejects.toThrow(ClaudeProcessError);
    await expect(result).rejects.toMatchObject({ exitCode: 7, stderr: "boom" });
  });

  it("resolves with stdout/stderr on success", async () => {
    const run = createClaudeProcessRunner(process.execPath);

    await expect(run(["-e", "process.stdout.write('hello')"])).resolves.toEqual({
      stdout: "hello",
      stderr: "",
    });
  });
});
