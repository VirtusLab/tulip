import { describe, expect, it } from "vitest";
import { runCommand } from "./exec.js";

// Spawns real (non-`gh`/`git`) processes to exercise the actual timeout path — no live `gh`/`git`
// calls are made here beyond what other test files already cover.

describe("runCommand", () => {
  it("resolves with stdout on success", async () => {
    const stdout = await runCommand(process.execPath, ["-e", "process.stdout.write('hello')"]);
    expect(stdout).toBe("hello");
  });

  it("kills the process and throws a clear timeout error when it doesn't exit in time", async () => {
    const result = runCommand(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      timeoutMs: 50,
    });

    await expect(result).rejects.toThrow(/timed out after 50ms/);
  });
});
