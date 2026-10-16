import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { AgentBinaryMissingError, AgentProcessError, AgentTimeoutError } from "./errors.js";
import { createAgentProcessRunner } from "./exec.js";

// These spawn real (non-agent) processes to exercise the actual error-classification and
// stdin-delivery paths — no live agent/LLM calls are made anywhere in this file.

describe("createAgentProcessRunner", () => {
  it("throws AgentBinaryMissingError, naming the binary and install hint, when it isn't on PATH", async () => {
    const bin = "tulip-agent-binary-that-does-not-exist";
    const run = createAgentProcessRunner(bin, { installHint: "install the thing" });

    const result = run(["-p"], "hi");
    await expect(result).rejects.toThrow(AgentBinaryMissingError);
    await expect(result).rejects.toThrow(`\`${bin}\` binary not found on PATH — install the thing`);
  });

  it("throws AgentProcessError with the exit code and stderr on a non-zero exit", async () => {
    const run = createAgentProcessRunner(process.execPath);
    const result = run(["-e", "process.stderr.write('boom'); process.exit(7)"], "unused input");

    await expect(result).rejects.toThrow(AgentProcessError);
    await expect(result).rejects.toMatchObject({ exitCode: 7, stderr: "boom" });
  });

  it("resolves with stdout/stderr on success", async () => {
    const run = createAgentProcessRunner(process.execPath);

    await expect(run(["-e", "process.stdout.write('hello')"], "unused input")).resolves.toEqual({
      stdout: "hello",
      stderr: "",
    });
  });

  it("kills the child and rejects with AgentTimeoutError when it doesn't exit within the timeout", async () => {
    const run = createAgentProcessRunner(process.execPath, { timeoutMs: 50 });
    // Never exits on its own — proves the runner kills it rather than waiting forever.
    const result = run(["-e", "setInterval(() => {}, 1000)"], "unused input");

    await expect(result).rejects.toThrow(AgentTimeoutError);
    await expect(result).rejects.toThrow(/50ms/);
  });

  it("spawns the child with the given cwd", async () => {
    const run = createAgentProcessRunner(process.execPath);
    const dir = realpathSync(tmpdir());

    const result = await run(["-e", "process.stdout.write(process.cwd())"], "unused input", {
      cwd: dir,
    });

    expect(result.stdout).toBe(dir);
  });

  it("delivers `input` to the child's stdin rather than argv", async () => {
    const run = createAgentProcessRunner(process.execPath);
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
