import { describe, expect, it, vi } from "vitest";
import type { ClassifiableChange } from "../classification/types.js";
import type { ClaudeProcessResult } from "../claude/exec.js";
import {
  findUnreferencedChanges,
  SnippetCoverageError,
  verifySnippetCoverage,
} from "./coverage.js";
import { serializeSnippetRef } from "./markup.js";

function change(overrides: Partial<ClassifiableChange> = {}): ClassifiableChange {
  return {
    id: "c1",
    path: "src/fetch.ts",
    status: "modified",
    side: "head",
    range: { start: 10, end: 14 },
    excerpt: "+line",
    lines: ["+line"],
    ...overrides,
  };
}

function envelope(structuredOutput: unknown, sessionId: string): ClaudeProcessResult {
  return {
    stdout: JSON.stringify({
      result: "done",
      session_id: sessionId,
      structured_output: structuredOutput,
    }),
    stderr: "",
  };
}

describe("findUnreferencedChanges", () => {
  it("treats a change as covered when a single snippet ref spans its whole range", () => {
    const ref = serializeSnippetRef({
      path: "src/fetch.ts",
      side: "head",
      lines: { start: 5, end: 20 },
      unfold: true,
    });

    expect(findUnreferencedChanges(`intro\n\n${ref}\n`, [change()])).toEqual([]);
  });

  it("treats a change as covered when adjacent/overlapping refs together span its range", () => {
    const first = serializeSnippetRef({
      path: "src/fetch.ts",
      side: "head",
      lines: { start: 10, end: 12 },
      unfold: true,
    });
    const second = serializeSnippetRef({
      path: "src/fetch.ts",
      side: "head",
      lines: { start: 12, end: 14 },
      unfold: false,
    });

    expect(findUnreferencedChanges(`${first}\n\n${second}`, [change()])).toEqual([]);
  });

  it("flags a change with no ref at all as unreferenced", () => {
    expect(findUnreferencedChanges("just prose, no refs", [change()])).toEqual([change()]);
  });

  it("flags a change only partially covered by a ref", () => {
    const ref = serializeSnippetRef({
      path: "src/fetch.ts",
      side: "head",
      lines: { start: 10, end: 12 },
      unfold: true,
    });

    expect(findUnreferencedChanges(ref, [change()])).toEqual([change()]);
  });

  it("ignores a ref for a different file", () => {
    const ref = serializeSnippetRef({
      path: "src/other.ts",
      side: "head",
      lines: { start: 1, end: 100 },
      unfold: true,
    });

    expect(findUnreferencedChanges(ref, [change()])).toEqual([change()]);
  });

  it("ignores a ref for the same file but the wrong side", () => {
    const ref = serializeSnippetRef({
      path: "src/fetch.ts",
      side: "base",
      lines: { start: 1, end: 100 },
      unfold: true,
    });

    expect(findUnreferencedChanges(ref, [change()])).toEqual([change()]);
  });
});

describe("verifySnippetCoverage", () => {
  it("returns immediately when every change is already referenced", async () => {
    const ref = serializeSnippetRef({
      path: "src/fetch.ts",
      side: "head",
      lines: { start: 10, end: 14 },
      unfold: true,
    });
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) => envelope({}, "x"));

    const result = await verifySnippetCoverage(ref, "session-1", [change()], { runClaudeProcess });

    expect(result).toEqual({ markdown: ref, sessionId: "session-1" });
    expect(runClaudeProcess).not.toHaveBeenCalled();
  });

  it("resumes the session listing missing changes and returns the amended markdown", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], input: string) => {
      expect(input).toContain("src/fetch.ts");
      expect(input).toContain("head");
      expect(input).toContain("10-14");
      const ref = serializeSnippetRef({
        path: "src/fetch.ts",
        side: "head",
        lines: { start: 10, end: 14 },
        unfold: true,
      });
      return envelope({ markdown: `amended\n\n${ref}` }, "session-2");
    });

    const result = await verifySnippetCoverage("original, no refs", "session-1", [change()], {
      runClaudeProcess,
    });

    expect(result.sessionId).toBe("session-2");
    expect(result.markdown).toContain("amended");
    expect(runClaudeProcess).toHaveBeenCalledTimes(1);
  });

  it("throws SnippetCoverageError listing missing changes after 3 amend attempts", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({ markdown: "still no refs" }, "session-2"),
    );

    await expect(
      verifySnippetCoverage("no refs", "session-1", [change()], { runClaudeProcess }),
    ).rejects.toThrow(SnippetCoverageError);
    expect(runClaudeProcess).toHaveBeenCalledTimes(3);
  });

  it("includes the missing change's location in the thrown error", async () => {
    const runClaudeProcess = vi.fn(async () => envelope({ markdown: "no refs" }, "s"));

    await expect(
      verifySnippetCoverage("no refs", "session-1", [change()], { runClaudeProcess }),
    ).rejects.toThrow(/src\/fetch\.ts.*head 10-14/);
  });
});
