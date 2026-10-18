import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { AgentBinaryMissingError, AgentProcessError, AgentTimeoutError } from "./errors.js";
import { createAgentProcessRunner } from "./exec.js";

// These spawn real (non-agent) processes to exercise the actual error-classification and
// stdin-delivery paths — no live agent/LLM calls are made anywhere in this file.

const OPTIONS = { installHint: "install node" };

describe("createAgentProcessRunner", () => {
  it("throws AgentBinaryMissingError, naming the binary and install hint, when it isn't on PATH", async () => {
    const bin = "tulip-agent-binary-that-does-not-exist";
    const run = createAgentProcessRunner(bin, { installHint: "install the thing" });

    const result = run(["-p"], "hi");
    await expect(result).rejects.toThrow(AgentBinaryMissingError);
    await expect(result).rejects.toThrow(`\`${bin}\` binary not found on PATH — install the thing`);
  });

  it("throws AgentProcessError with the exit code and stderr on a non-zero exit", async () => {
    const run = createAgentProcessRunner(process.execPath, OPTIONS);
    const result = run(["-e", "process.stderr.write('boom'); process.exit(7)"], "unused input");

    await expect(result).rejects.toThrow(AgentProcessError);
    await expect(result).rejects.toMatchObject({ exitCode: 7, detail: "boom" });
  });

  it("prefers describeFailure's reading of stdout over stderr", async () => {
    const run = createAgentProcessRunner(process.execPath, {
      ...OPTIONS,
      describeFailure: (stdout) => `parsed ${stdout}`,
    });
    const result = run(
      ["-e", "process.stdout.write('oops'); process.stderr.write('boom'); process.exit(1)"],
      "unused input",
    );

    await expect(result).rejects.toMatchObject({ detail: "parsed oops" });
  });

  it("uses stderr when describeFailure finds nothing, unless stderr is only whitespace", async () => {
    const run = createAgentProcessRunner(process.execPath, {
      ...OPTIONS,
      describeFailure: () => undefined,
    });
    const exitWith = (stderr: string) =>
      run(
        [
          "-e",
          `process.stdout.write('out'); process.stderr.write(${JSON.stringify(stderr)}); process.exit(1)`,
        ],
        "unused input",
      );

    await expect(exitWith("boom")).rejects.toMatchObject({ detail: "boom" });
    await expect(exitWith(" \n")).rejects.toMatchObject({ detail: "out" });
  });

  it("falls back to stdout's last 500 characters when stderr is empty and nothing describes the failure", async () => {
    const run = createAgentProcessRunner(process.execPath, {
      ...OPTIONS,
      describeFailure: () => undefined,
    });
    const stdout = `${"a".repeat(1000)}${"b".repeat(493)}the end`;
    const result = run(
      ["-e", `process.stdout.write(${JSON.stringify(stdout)}); process.exit(1)`],
      "unused input",
    );

    await expect(result).rejects.toMatchObject({ detail: `…${"b".repeat(493)}the end` });
  });

  it("keeps the forge tokens tulip itself uses out of the child's environment", async () => {
    vi.stubEnv("GITHUB_TOKEN", "github-secret");
    vi.stubEnv("GH_TOKEN", "gh-secret");
    vi.stubEnv("GITLAB_TOKEN", "gitlab-secret");
    try {
      const run = createAgentProcessRunner(process.execPath, OPTIONS);
      const { stdout } = await run(
        [
          "-e",
          "const e = process.env; process.stdout.write(JSON.stringify([e.GITHUB_TOKEN, e.GH_TOKEN, e.GITLAB_TOKEN, e.PATH !== undefined]))",
        ],
        "unused input",
      );

      expect(JSON.parse(stdout)).toEqual([null, null, null, true]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("resolves with stdout/stderr on success", async () => {
    const run = createAgentProcessRunner(process.execPath, OPTIONS);

    await expect(run(["-e", "process.stdout.write('hello')"], "unused input")).resolves.toEqual({
      stdout: "hello",
      stderr: "",
    });
  });

  it("kills the child and rejects with AgentTimeoutError when it doesn't exit within the timeout", async () => {
    const run = createAgentProcessRunner(process.execPath, {
      ...OPTIONS,
      timeoutMs: 50,
    });
    // Never exits on its own — proves the runner kills it rather than waiting forever.
    const result = run(["-e", "setInterval(() => {}, 1000)"], "unused input");

    await expect(result).rejects.toThrow(AgentTimeoutError);
    await expect(result).rejects.toThrow(/50ms/);
  });

  it("spawns the child with the given cwd", async () => {
    const run = createAgentProcessRunner(process.execPath, OPTIONS);
    const dir = realpathSync(tmpdir());

    const result = await run(["-e", "process.stdout.write(process.cwd())"], "unused input", {
      cwd: dir,
    });

    expect(result.stdout).toBe(dir);
  });

  it("delivers `input` to the child's stdin rather than argv", async () => {
    const run = createAgentProcessRunner(process.execPath, OPTIONS);
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
