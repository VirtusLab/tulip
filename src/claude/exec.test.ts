import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { ClaudeBinaryMissingError, ClaudeProcessError, ClaudeTimeoutError } from "./errors.js";
import { createClaudeProcessRunner } from "./exec.js";

// These spawn real (non-`claude`) processes to exercise the actual error-classification and
// stdin-delivery paths — no live `claude`/LLM calls are made anywhere in this file.

describe("createClaudeProcessRunner", () => {
  it("throws ClaudeBinaryMissingError when the binary isn't on PATH", async () => {
    const run = createClaudeProcessRunner("tulip-claude-binary-that-does-not-exist");

    await expect(run(["-p"], "hi")).rejects.toThrow(ClaudeBinaryMissingError);
  });

  it("throws ClaudeProcessError with the exit code and stderr on a non-zero exit", async () => {
    const run = createClaudeProcessRunner(process.execPath);
    const result = run(["-e", "process.stderr.write('boom'); process.exit(7)"], "unused input");

    await expect(result).rejects.toThrow(ClaudeProcessError);
    await expect(result).rejects.toMatchObject({ exitCode: 7, stderr: "boom" });
  });

  it("resolves with stdout/stderr on success", async () => {
    const run = createClaudeProcessRunner(process.execPath);

    await expect(run(["-e", "process.stdout.write('hello')"], "unused input")).resolves.toEqual({
      stdout: "hello",
      stderr: "",
    });
  });

  it("kills the child and rejects with ClaudeTimeoutError when it doesn't exit within the timeout", async () => {
    const run = createClaudeProcessRunner(process.execPath, 50);
    // Never exits on its own — proves the runner kills it rather than waiting forever.
    const result = run(["-e", "setInterval(() => {}, 1000)"], "unused input");

    await expect(result).rejects.toThrow(ClaudeTimeoutError);
    await expect(result).rejects.toThrow(/50ms/);
  });

  it("spawns the child with the given cwd", async () => {
    const run = createClaudeProcessRunner(process.execPath);
    const dir = realpathSync(tmpdir());

    const result = await run(["-e", "process.stdout.write(process.cwd())"], "unused input", {
      cwd: dir,
    });

    expect(result.stdout).toBe(dir);
  });

  it("delivers `input` to the child's stdin rather than argv", async () => {
    const run = createClaudeProcessRunner(process.execPath);
    // Echoes whatever it reads from stdin back out on stdout — proves the prompt actually
    // reaches the process via stdin, not as a command-line argument.
    const echoStdin =
      "let data = ''; process.stdin.on('data', (c) => { data += c; }); " +
      "process.stdin.on('end', () => { process.stdout.write(data); });";

    const largePrompt = "x".repeat(200_000); // well past the ~128KB argv (E2BIG) limit this fix avoids

    await expect(run(["-e", echoStdin], largePrompt)).resolves.toEqual({
      stdout: largePrompt,
      stderr: "",
    });
  });
});
