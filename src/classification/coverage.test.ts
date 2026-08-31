import { describe, expect, it, vi } from "vitest";
import type { Category } from "../categories/types.js";
import type { ClaudeProcessResult } from "../claude/exec.js";
import type { ResolvedChange } from "./classify.js";
import {
  findUncoveredChangeIds,
  IncompleteCoverageError,
  verifyAndRepairCoverage,
} from "./coverage.js";
import type { ClassificationState } from "./escape-hatch.js";
import type { ClassifiableChange } from "./types.js";

const CATEGORIES: Category[] = [
  { id: "c1", name: "Retry logic", description: "Adds backoff retries.", attention: "normal" },
];

function change(id: string): ClassifiableChange {
  return {
    id,
    path: "src/fetch.ts",
    status: "modified",
    side: "head",
    range: { start: 1, end: 1 },
    excerpt: "+line",
    lines: ["+line"],
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
    categories: CATEGORIES,
    phase1SessionId: "phase1-session",
    classifierSessionId: "classifier-session",
    acceptedNewCategories: 0,
    consultedChangeIds: new Set(),
  };
}

describe("findUncoveredChangeIds", () => {
  it("flags changes missing from the map, and changes with an empty assignment list", () => {
    const changes = [change("c1"), change("c2"), change("c3")];
    const resolved = new Map<string, ResolvedChange>([
      ["c1", { kind: "categorized", assignments: [{ category: "c1", codeType: "production" }] }],
      ["c2", { kind: "categorized", assignments: [] }],
      // c3 absent entirely
    ]);

    expect(findUncoveredChangeIds(changes, resolved, CATEGORIES)).toEqual(["c2", "c3"]);
  });

  it("does not flag ignored changes", () => {
    const changes = [change("c1")];
    const resolved = new Map<string, ResolvedChange>([["c1", { kind: "ignored" }]]);

    expect(findUncoveredChangeIds(changes, resolved, CATEGORIES)).toEqual([]);
  });

  it("matches category ids exactly — a case/whitespace variant does not count as covered", () => {
    // Ids are code-assigned "c<N>" tokens constrained by the classify schema's enum, so the
    // classifier can't actually reply with a variant like this — but matching is exact, not
    // normalized, so this deliberately mangled id is (correctly) still uncovered.
    const changes = [change("c1")];
    const resolved = new Map<string, ResolvedChange>([
      [
        "c1",
        {
          kind: "categorized",
          assignments: [{ category: " C1 ", codeType: "production" }],
        },
      ],
    ]);

    expect(findUncoveredChangeIds(changes, resolved, CATEGORIES)).toEqual(["c1"]);
  });

  it("flags a change assigned to a category id that doesn't exist as still uncovered", () => {
    const changes = [change("c1")];
    const resolved = new Map<string, ResolvedChange>([
      [
        "c1",
        {
          kind: "categorized",
          assignments: [{ category: "c99", codeType: "production" }],
        },
      ],
    ]);

    expect(findUncoveredChangeIds(changes, resolved, CATEGORIES)).toEqual(["c1"]);
  });

  it("regression (docs/adr/0005): a change assigned by a slightly different NAME is NOT covered, but by the correct ID it IS", () => {
    // The original bug: phase 1 can produce a long, paraphrase-prone name (e.g. "Tests and docs
    // (JsonFlowTest.java, docs/json.md, README.md, ...)"). A classifier reply that echoes back
    // even a close paraphrase of the name must NOT count as coverage — only the id does.
    const longNameCategories = [
      {
        id: "c1",
        name: "Tests and docs (JsonFlowTest.java, docs/json.md, README.md, ...)",
        description: "Adds backoff retries.",
        attention: "normal" as const,
      },
    ];
    const changes = [change("c1")];
    const byParaphrasedName = new Map<string, ResolvedChange>([
      [
        "c1",
        {
          kind: "categorized",
          // Close, but not exact — a plausible haiku paraphrase of the long name above.
          assignments: [{ category: "Tests and docs", codeType: "production" }],
        },
      ],
    ]);
    const byCorrectId = new Map<string, ResolvedChange>([
      ["c1", { kind: "categorized", assignments: [{ category: "c1", codeType: "production" }] }],
    ]);

    expect(findUncoveredChangeIds(changes, byParaphrasedName, longNameCategories)).toEqual(["c1"]);
    expect(findUncoveredChangeIds(changes, byCorrectId, longNameCategories)).toEqual([]);
  });
});

describe("verifyAndRepairCoverage", () => {
  it("returns immediately when every change is already covered", async () => {
    const changes = [change("c1")];
    const changesById = new Map(changes.map((c) => [c.id, c]));
    const resolved = new Map<string, ResolvedChange>([
      ["c1", { kind: "categorized", assignments: [{ category: "c1", codeType: "production" }] }],
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
      ["c1", { kind: "categorized", assignments: [{ category: "c1", codeType: "production" }] }],
      // c2 missing
    ]);
    const runClaudeProcess = vi.fn(async (_args: string[], input: string) => {
      expect(input).toContain("c2");
      expect(input).not.toContain("id: c1");
      return envelope(
        {
          classifications: [
            { changeId: "c2", assignments: [{ category: "c1", codeType: "test" }] },
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
      assignments: [{ category: "c1", codeType: "test" }],
    });
    expect(runClaudeProcess).toHaveBeenCalledTimes(1);
    expect(state.classifierSessionId).toBe("classifier-session-2");
  });

  it("treats a change assigned to an unknown category as uncovered and repairs it", async () => {
    const changes = [change("c1")];
    const changesById = new Map(changes.map((c) => [c.id, c]));
    const resolved = new Map<string, ResolvedChange>([
      ["c1", { kind: "categorized", assignments: [{ category: "c99", codeType: "production" }] }],
    ]);
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope(
        {
          classifications: [
            { changeId: "c1", assignments: [{ category: "c1", codeType: "production" }] },
          ],
        },
        "classifier-session-2",
      ),
    );

    const result = await verifyAndRepairCoverage(changes, changesById, resolved, baseState(), {
      runClaudeProcess,
    });

    expect(result.get("c1")).toEqual({
      kind: "categorized",
      assignments: [{ category: "c1", codeType: "production" }],
    });
    expect(runClaudeProcess).toHaveBeenCalledTimes(1);
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
