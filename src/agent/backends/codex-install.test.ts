import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentBinaryMissingError } from "../errors.js";
import {
  executableFromDoctorReport,
  findCodexExecutable,
  sandboxReadDirs,
} from "./codex-install.js";

const HINT = "install codex";

function doctorReport(executable: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    checks: {
      installation: { id: "installation", details: { "current executable": executable } },
    },
  });
}

describe("sandboxReadDirs", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("is the executable's dir plus the helper dirs next to it that exist", async () => {
    dir = await mkdtemp(join(tmpdir(), "tulip-codex-install-"));
    await mkdir(join(dir, "bin"));
    await mkdir(join(dir, "codex-path"));

    expect(sandboxReadDirs(join(dir, "bin", "codex"))).toEqual([
      join(dir, "bin"),
      join(dir, "codex-path"),
    ]);
  });
});

describe("executableFromDoctorReport", () => {
  it("reads the installation check's current executable", () => {
    expect(executableFromDoctorReport(doctorReport("/x/bin/codex"))).toBe("/x/bin/codex");
  });

  it("falls back to the runtime provenance check", () => {
    const report = JSON.stringify({
      checks: { "runtime.provenance": { details: { "current executable": "/y/codex" } } },
    });

    expect(executableFromDoctorReport(report)).toBe("/y/codex");
  });

  it("is undefined for a report without it, or not JSON", () => {
    expect(executableFromDoctorReport(JSON.stringify({ checks: {} }))).toBeUndefined();
    expect(executableFromDoctorReport("not json")).toBeUndefined();
  });
});

describe("findCodexExecutable", () => {
  it("asks `<bin> doctor --json`", async () => {
    const calls: string[][] = [];
    const executable = await findCodexExecutable("my-codex", HINT, async (bin, args) => {
      calls.push([bin, ...args]);
      return doctorReport("/x/bin/codex");
    });

    expect(executable).toBe("/x/bin/codex");
    expect(calls).toEqual([["my-codex", "doctor", "--json"]]);
  });

  it("reads the report from a non-zero exit's stdout", async () => {
    const executable = await findCodexExecutable("codex", HINT, async () => {
      throw Object.assign(new Error("exit 1"), { stdout: doctorReport("/x/bin/codex") });
    });

    expect(executable).toBe("/x/bin/codex");
  });

  it("throws when the report doesn't name the executable", async () => {
    await expect(findCodexExecutable("codex", HINT, async () => "{}")).rejects.toThrow(
      /didn't report Codex's executable/,
    );
  });

  it("throws AgentBinaryMissingError, with the install hint, when the binary isn't on PATH", async () => {
    const result = findCodexExecutable("codex", HINT, async () => {
      throw Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT", stdout: "" });
    });

    await expect(result).rejects.toThrow(AgentBinaryMissingError);
    await expect(result).rejects.toThrow(/install codex/);
  });

  it("rethrows a failure that printed nothing on stdout unchanged", async () => {
    const failure = Object.assign(new Error("wrapper failed: bad config"), { stdout: "" });

    await expect(
      findCodexExecutable("codex", HINT, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });
});
