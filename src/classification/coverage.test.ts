import { describe, expect, it, vi } from "vitest";
import type { ClaudeProcessResult } from "../claude/exec.js";
import type { ResolvedChange } from "./classify.js";
import {
  findUncoveredChangeIds,
  IncompleteCoverageError,
  verifyAndRepairCoverage,
} from "./coverage.js";
import type { ClassificationState } from "./escape-hatch.js";
import type { ClassifiableChange } from "./types.js";

function change(id: string): ClassifiableChange {
  return {
    id,
    path: "src/fetch.ts",
    status: "modified",
    side: "head",
    range: { start: 1, end: 1 },
    excerpt: "+line",
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

function baseState(): ClassificationState {
  return {
    categories: [{ name: "Retry logic", description: "Adds backoff retries." }],
    phase1SessionId: "phase1-session",
    classifierSessionId: "classifier-session",
    acceptedNewCategories: 0,
  };
}

describe("findUncoveredChangeIds", () => {
  it("flags changes missing from the map, and changes with an empty assignment list", () => {
    const changes = [change("c1"), change("c2"), change("c3")];
    const resolved = new Map<string, ResolvedChange>([
      [
        "c1",
        { kind: "categorized", assignments: [{ category: "Retry logic", codeType: "production" }] },
      ],
      ["c2", { kind: "categorized", assignments: [] }],
      // c3 absent entirely
    ]);

    expect(findUncoveredChangeIds(changes, resolved)).toEqual(["c2", "c3"]);
  });

  it("does not flag ignored changes", () => {
    const changes = [change("c1")];
    const resolved = new Map<string, ResolvedChange>([["c1", { kind: "ignored" }]]);

    expect(findUncoveredChangeIds(changes, resolved)).toEqual([]);
  });
});

describe("verifyAndRepairCoverage", () => {
  it("returns immediately when every change is already covered", async () => {
    const changes = [change("c1")];
    const changesById = new Map(changes.map((c) => [c.id, c]));
    const resolved = new Map<string, ResolvedChange>([
      [
        "c1",
        { kind: "categorized", assignments: [{ category: "Retry logic", codeType: "production" }] },
      ],
    ]);
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) => envelope({}, "x"));

    const result = await verifyAndRepairCoverage(changes, changesById, resolved, baseState(), {
      runClaudeProcess,
    });

    expect(result).toBe(resolved);
    expect(runClaudeProcess).not.toHaveBeenCalled();
  });

  it("re-asks the classifier for just the missing changes and repairs coverage", async () => {
    const changes = [change("c1"), change("c2")];
    const changesById = new Map(changes.map((c) => [c.id, c]));
    const resolved = new Map<string, ResolvedChange>([
      [
        "c1",
        { kind: "categorized", assignments: [{ category: "Retry logic", codeType: "production" }] },
      ],
      // c2 missing
    ]);
    const runClaudeProcess = vi.fn(async (_args: string[], input: string) => {
      expect(input).toContain("c2");
      expect(input).not.toContain("id: c1");
      return envelope(
        {
          classifications: [
            { changeId: "c2", assignments: [{ category: "Retry logic", codeType: "test" }] },
          ],
        },
        "classifier-session-2",
      );
    });

    const state = baseState();
    const result = await verifyAndRepairCoverage(changes, changesById, resolved, state, {
      runClaudeProcess,
    });

    expect(result.get("c2")).toEqual({
      kind: "categorized",
      assignments: [{ category: "Retry logic", codeType: "test" }],
    });
    expect(runClaudeProcess).toHaveBeenCalledTimes(1);
    expect(state.classifierSessionId).toBe("classifier-session-2");
  });

  it("throws IncompleteCoverageError listing uncovered changes after 3 repair attempts", async () => {
    const changes = [change("c1")];
    const changesById = new Map(changes.map((c) => [c.id, c]));
    const resolved = new Map<string, ResolvedChange>();
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({ classifications: [] }, "s"),
    );

    await expect(
      verifyAndRepairCoverage(changes, changesById, resolved, baseState(), { runClaudeProcess }),
    ).rejects.toThrow(IncompleteCoverageError);
    expect(runClaudeProcess).toHaveBeenCalledTimes(3);
  });

  it("includes uncovered change ranges in the thrown error", async () => {
    const changes = [change("c1")];
    const changesById = new Map(changes.map((c) => [c.id, c]));
    const runClaudeProcess = vi.fn(async () => envelope({ classifications: [] }, "s"));

    await expect(
      verifyAndRepairCoverage(changes, changesById, new Map(), baseState(), { runClaudeProcess }),
    ).rejects.toThrow(/src\/fetch\.ts.*head 1-1/);
  });
});
